/** Baseline symptoms and explicit repaired-domain rejection; never relabel invalid timing as valid. */
const runtime = new URL(process.env.VSM_REVIEW_RUNTIME_URL ?? '../js/', import.meta.url);
const { LungModel } = await import(new URL('lung-model.js', runtime));
const { Ventilator, SUPPORTED_MODES } = await import(new URL('ventilator.js', runtime));
const { SimulationEngine } = await import(new URL('simulation.js', runtime));
function make(mode, settings = {}, lungSettings = {}) {
    const lung = new LungModel({ resistance: 10, compliance: .05, ...lungSettings });
    const vent = new Ventilator(lung, { mode, respiratoryRate: 12, ...settings });
    return { sim: new SimulationEngine(vent), vent };
}
const cadence = [];
for (const hz of [60, 120, 144, 240]) for (const speed of [.5, 1, 2, 4]) {
    const { sim } = make('vc-cmv'); sim.setSpeed(speed);
    for (let i = 0; i < hz * 30; i++) sim.advance(1 / hz);
    cadence.push({ hz, speed, suppliedSeconds: 30, expectedSeconds: 30 * speed, actualSeconds: +sim.globalTime.toFixed(6) });
}
const efforts = [];
for (const mode of SUPPORTED_MODES) for (const neuralTi of [2, 1]) {
    const { sim, vent } = make(mode, { respiratoryRate: 6, ieRatio: [1, 4], pMusMax: 4,
        neuralTi: 1, triggerType: 'pressure', pressureTriggerCmH2O: 5 });
    let rejection = null;
    if (typeof sim.configureEffortTiming === 'function') {
        sim.configureEffortTiming({ patientRR: 35, neuralTi: 1 }, true);
        try { sim.requestEffortTiming({ patientRR: 35, neuralTi }); }
        catch (error) { rejection = error.message; }
        sim.reset();
    } else { vent.neuralTi = neuralTi; sim.patientRR = 35; sim.reset(); }
    const eligible = new Set(), sampled = new Set(); let largestStep = 0, priorPmus = 0;
    for (let i = 0; i < 6000; i++) {
        sim.tick(); const p = sim.physicsSample;
        if (p.neuralCycleId > 0 && p.pmus_cmH2O > 0) {
            sampled.add(p.neuralCycleId);
            if (p.phase === 'EXPIRATION' && p.phaseTime_s > .1) eligible.add(p.neuralCycleId);
        }
        largestStep = Math.max(largestStep, Math.abs(p.pmus_cmH2O - priorPmus)); priorPmus = p.pmus_cmH2O;
    }
    const terminal = sim.triggerEvents.filter(e => e.type === 'failed' || e.type === 'patient');
    const outcomeIds = terminal.map(e => e.neuralCycleId ?? e.detection?.neuralCycleId);
    const completedCycles = [...sampled].filter(id => id < sim.neuralCycleId);
    efforts.push({ mode, neuralTi, inputAccepted: rejection === null, rejection,
        effectiveNeuralTi: vent.neuralTi, ticks: 6000, startedCycles: sim.neuralCycleId,
        completedCycles: completedCycles.length, terminalEvents: terminal.length,
        eligibleCyclesRestartedWithoutOutcome: completedCycles.filter(id => eligible.has(id) && !outcomeIds.includes(id)),
        duplicateOutcomeIds: outcomeIds.filter((id, i) => outcomeIds.indexOf(id) !== i), largestPmusStep: largestStep });
}
console.log(JSON.stringify({ runtime: runtime.href, cadence, efforts }, null, 2));
