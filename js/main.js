/**
 * ============================================================================
 * main.js — Application Integration Layer (Dynamic Simulation)
 * ============================================================================
 *
 * Wires together:
 *   - LungModel          (the patient's lung physics)
 *   - Ventilator          (settings + analytical predictions)
 *   - SimulationEngine    (tick-based real-time simulation)
 *   - WaveformDisplay     (scrolling three-panel waveform rendering)
 *   - DOM controls        (the operator's hands)
 *
 * Architecture:
 *   requestAnimationFrame loop → sim.advance(dt) → display.renderFromSim(sim)
 *
 *   The SimulationEngine reads settings from the Ventilator at each breath
 *   start. Lung mechanics (R, C) are read live every tick. This means:
 *     - Changing VT, RR, mode → takes effect on next breath (realistic)
 *     - Changing R, C, PEEP → takes effect immediately (realistic)
 *
 * ============================================================================
 */

import { LungModel }        from './lung-model.js?v=8';
import { Ventilator }        from './ventilator.js?v=8';
import { SimulationEngine }  from './simulation.js?v=8';
import { WaveformDisplay, LoopRenderer }   from './waveforms.js?v=8';


// =============================================================================
// STATE
// =============================================================================

let lung;
let vent;
let sim;
let display;
let pvLoop;
let fvLoop;
let loopsVisible = true;
let currentIE   = [1, 2];
let lastFrameTs = null;
let animFrame   = null;


// =============================================================================
// INITIALIZATION
// =============================================================================

function init() {
    lung = LungModel.fromPreset('normal');
    vent = new Ventilator(lung, {
        mode:                'vc-cmv',
        flowPattern:         'square',
        holdTime:            0,
        pMusMax:             0,
        neuralTi:            1.0,
        tidalVolume:         0.500,
        inspiratoryPressure: 15,
        respiratoryRate:     14,
        ieRatio:             [1, 2],
        peep:                5,
        fio2:                0.40,
    });

    sim = new SimulationEngine(vent, {
        sampleRate:     100,
        displaySeconds: 10,
    });

    display = new WaveformDisplay({
        pressure: document.getElementById('canvas-pressure'),
        volume:   document.getElementById('canvas-volume'),
        flow:     document.getElementById('canvas-flow'),
    }, 4);

    // --- Loop Renderers ---
    //   P-V Loop: Pressure (x) vs Volume (y)
    //     Clinical convention: Paw on x-axis, tidal volume on y-axis.
    //     Inspiratory limb goes right and up, expiratory limb returns.
    //
    //   F-V Loop: Volume (x) vs Flow (y)
    //     Inspiratory flow positive (top), expiratory negative (bottom).
    //     Scooped expiratory limb = obstruction.
    pvLoop = new LoopRenderer(document.getElementById('canvas-pv-loop'), {
        xLabel: 'Paw (cmH₂O)',
        yLabel: 'Vol (mL)',
        color:  '#f0c050',
        traceColor: 'rgba(240, 192, 80, 0.3)',
    });

    fvLoop = new LoopRenderer(document.getElementById('canvas-fv-loop'), {
        xLabel: 'Vol (mL)',
        yLabel: 'Flow (L/min)',
        color:  '#66bb6a',
        traceColor: 'rgba(102, 187, 106, 0.3)',
    });

    // --- Bind all controls ---
    bindSlider('vt',            onVtChange);
    bindSlider('rr',            onRrChange);
    bindSlider('pinsp',         onPinspChange);
    bindSlider('peep',          onPeepChange);
    bindSlider('fio2',          onFio2Change);
    bindSlider('compliance',    onComplianceChange);
    bindSlider('resistance',    onResistanceChange);
    bindSlider('hold-duration', onHoldDurationChange);
    bindSlider('pmus-max',      onPmusMaxChange);
    bindSlider('neural-ti',     onNeuralTiChange);
    bindSlider('patient-rr',    onPatientRRChange);

    bindPresetSelector();
    bindIEButtons();
    bindModeToggle();
    bindFlowPatternToggle();
    bindHoldToggle();
    bindPmusToggle();
    bindTransportControls();
    bindLoopToggle();
    bindTeachingModeToggle();
    bindCollapsibles();

    // --- Handle window resize ---
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => renderFrame(), 100);
    });

    // --- Start the animation loop ---
    lastFrameTs = performance.now();
    animFrame = requestAnimationFrame(animate);
}


// =============================================================================
// ANIMATION LOOP
// =============================================================================

function animate(timestamp) {
    const realDt = (timestamp - lastFrameTs) / 1000;
    lastFrameTs = timestamp;

    sim.advance(realDt);
    renderFrame();

    animFrame = requestAnimationFrame(animate);
}

function renderFrame() {
    display.renderFromSim(sim);
    if (loopsVisible) renderLoops();
    updateParams();
    updateBreathInfo();
}

/**
 * Render P-V and F-V loops from per-breath simulation data.
 */
function renderLoops() {
    const completed = sim.loopCompleted;
    const current   = sim.loopCurrent;

    // P-V Loop: X = pressure, Y = volume
    pvLoop.render(
        { x: completed.pressure, y: completed.volume },
        { x: current.pressure,   y: current.volume },
        { xMin: 0 }
    );

    // F-V Loop: X = volume, Y = flow
    fvLoop.render(
        { x: completed.volume, y: completed.flow },
        { x: current.volume,   y: current.flow },
        { xMin: 0 }
    );
}


// =============================================================================
// MODE SWITCHING
// =============================================================================

function bindModeToggle() {
    const group = document.getElementById('mode-toggle');
    group.addEventListener('click', (e) => {
        const btn = e.target.closest('.mode-btn');
        if (!btn) return;

        const mode = btn.dataset.mode;
        vent.mode = mode;

        group.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('mode-btn--active'));
        btn.classList.add('mode-btn--active');

        applyModeUI(mode);
        sim.reset();
    });
}

function applyModeUI(mode) {
    const isPC = mode === 'pc-cmv';
    updateModeLabel();

    const vtControl      = document.getElementById('vt-control');
    const pinspControl   = document.getElementById('pinsp-control');
    const patternControl = document.getElementById('flow-pattern-control');

    if (isPC) {
        vtControl.classList.add('control--hidden');
        pinspControl.classList.remove('control--hidden');
        patternControl.classList.add('control--hidden');
    } else {
        vtControl.classList.remove('control--hidden');
        pinspControl.classList.add('control--hidden');
        patternControl.classList.remove('control--hidden');
    }

    document.getElementById('pinsp-param-row').style.display = isPC ? '' : 'none';
    document.getElementById('ti-tau-row').style.display      = isPC ? '' : 'none';

    document.getElementById('vt-param-label').innerHTML = isPC
        ? 'V<sub>T</sub> <span style="font-size:9px;opacity:0.5">(del)</span>'
        : 'V<sub>T</sub>';

    updateFlowLabel();

    document.getElementById('resist-label').innerHTML = isPC
        ? 'ΔP<sub>eff</sub>' : 'P<sub>resist</sub>';

    updateHoldResultsVisibility();
}

function updateModeLabel() {
    const modeLabel = document.getElementById('mode-label');
    const isPC = vent.mode === 'pc-cmv';

    let tag = 'set-point';
    if (!isPC && vent.flowPattern === 'ramp') tag = 'ramp';

    const holdTag = vent.holdActive
        ? '<span style="color:var(--color-pressure); margin-left:4px; font-size:10px;">⏸ HOLD</span>' : '';

    const pmusTag = sim.patientRR > 0
        ? '<span style="color:var(--color-volume); margin-left:4px; font-size:10px;">💪 EFFORT</span>' : '';

    const modeName = isPC ? 'PC-CMV' : 'VC-CMV';
    modeLabel.innerHTML = `${modeName}<span style="font-weight:normal; font-size:11px; opacity:0.5; margin-left:4px;">${tag}</span>${holdTag}${pmusTag}`;
}

function updateFlowLabel() {
    const label = document.getElementById('flow-param-label');
    if (vent.mode === 'pc-cmv') label.innerHTML = 'V̇<sub>peak</sub>';
    else if (vent.flowPattern === 'ramp') label.innerHTML = 'V̇<sub>peak</sub>';
    else label.innerHTML = 'V̇<sub>insp</sub>';
}


// =============================================================================
// FLOW PATTERN TOGGLE
// =============================================================================

function bindFlowPatternToggle() {
    const group = document.getElementById('flow-pattern-group');
    group.addEventListener('click', (e) => {
        const btn = e.target.closest('.ie-btn');
        if (!btn) return;

        vent.flowPattern = btn.dataset.pattern;
        group.querySelectorAll('.ie-btn').forEach(b => b.classList.remove('ie-btn--active'));
        btn.classList.add('ie-btn--active');

        document.getElementById('flow-pattern-display').textContent =
            btn.dataset.pattern === 'ramp' ? 'Ramp ╲' : 'Square ▬';

        updateModeLabel();
        updateFlowLabel();
        updateHoldResultsVisibility();
        sim.reset();
    });
}


// =============================================================================
// INSPIRATORY HOLD
// =============================================================================

function bindHoldToggle() {
    const btn = document.getElementById('hold-toggle');
    btn.addEventListener('click', () => {
        if (vent.holdActive) {
            vent.holdTime = 0;
            btn.classList.remove('hold-btn--active');
            document.getElementById('hold-icon').textContent = '▶';
            document.getElementById('hold-btn-label').textContent = 'Activate';
            document.getElementById('hold-display').textContent = 'Off';
            document.getElementById('hold-duration-group').style.display = 'none';
            document.getElementById('hold-results').style.display = 'none';
        } else {
            const dur = parseInt(document.getElementById('hold-duration').value) / 10;
            vent.holdTime = dur;
            btn.classList.add('hold-btn--active');
            document.getElementById('hold-icon').textContent = '⏸';
            document.getElementById('hold-btn-label').textContent = 'Release';
            document.getElementById('hold-display').textContent = `${dur.toFixed(1)}s`;
            document.getElementById('hold-duration-group').style.display = 'flex';
            document.getElementById('hold-results').style.display = '';
        }
        updateModeLabel();
        updateHoldResultsVisibility();
    });
}

function onHoldDurationChange(slider) {
    const dur = parseInt(slider.value) / 10;
    vent.holdTime = dur;
    document.getElementById('hold-duration-display').textContent = `${dur.toFixed(1)}s`;
    document.getElementById('hold-display').textContent = `${dur.toFixed(1)}s`;
}

function updateHoldResultsVisibility() {
    const rawRow = document.getElementById('hold-raw-row');
    if (rawRow) {
        const showRaw = vent.holdActive && vent.mode !== 'pc-cmv' && vent.flowPattern !== 'ramp';
        rawRow.style.display = showRaw ? '' : 'none';
    }
}


// =============================================================================
// PATIENT EFFORT + PATIENT RR
// =============================================================================

function bindPmusToggle() {
    const btn = document.getElementById('pmus-toggle');
    btn.addEventListener('click', () => {
        const wasActive = sim.patientRR > 0;

        if (wasActive) {
            vent.pMusMax = 0;
            sim.patientRR = 0;
            btn.classList.remove('hold-btn--active');
            document.getElementById('pmus-icon').textContent = '♿';
            document.getElementById('pmus-btn-label').textContent = 'Passive';
            document.getElementById('pmus-display').textContent = 'Off';
            document.getElementById('pmus-sliders').style.display = 'none';
            document.getElementById('patient-rr-control').style.display = 'none';
        } else {
            const pmax = parseInt(document.getElementById('pmus-max').value);
            const nti  = parseInt(document.getElementById('neural-ti').value) / 10;
            const prr  = parseInt(document.getElementById('patient-rr').value);
            vent.pMusMax  = pmax;
            vent.neuralTi = nti;
            sim.patientRR = prr;

            btn.classList.add('hold-btn--active');
            document.getElementById('pmus-icon').textContent = '💪';
            document.getElementById('pmus-btn-label').textContent = 'Active';
            document.getElementById('pmus-display').textContent = `${pmax} cmH₂O`;
            document.getElementById('pmus-sliders').style.display = '';
            document.getElementById('patient-rr-control').style.display = '';
        }
        updateModeLabel();
    });
}

function onPmusMaxChange(slider) {
    const pmax = parseInt(slider.value);
    vent.pMusMax = pmax;
    document.getElementById('pmus-max-display').textContent = `${pmax} cmH₂O`;
    document.getElementById('pmus-display').textContent = `${pmax} cmH₂O`;
}

function onNeuralTiChange(slider) {
    const nti = parseInt(slider.value) / 10;
    vent.neuralTi = nti;
    document.getElementById('neural-ti-display').textContent = `${nti.toFixed(1)}s`;
}

function onPatientRRChange(slider) {
    const prr = parseInt(slider.value);
    sim.patientRR = prr;
    document.getElementById('patient-rr-display').textContent = `${prr} /min`;
}


// =============================================================================
// TRANSPORT CONTROLS
// =============================================================================

function bindTransportControls() {
    const pauseBtn = document.getElementById('btn-pause');
    pauseBtn.addEventListener('click', () => {
        sim.toggle();
        if (sim.running) {
            pauseBtn.textContent = '⏸';
            pauseBtn.classList.remove('transport-btn--paused');
            lastFrameTs = performance.now();
        } else {
            pauseBtn.textContent = '▶';
            pauseBtn.classList.add('transport-btn--paused');
        }
    });

    const speedGroup = document.getElementById('speed-group');
    speedGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.speed-btn');
        if (!btn) return;
        sim.setSpeed(parseInt(btn.dataset.speed));
        speedGroup.querySelectorAll('.speed-btn').forEach(b =>
            b.classList.remove('speed-btn--active'));
        btn.classList.add('speed-btn--active');
    });
}


// =============================================================================
// LOOP TOGGLE
// =============================================================================

function bindLoopToggle() {
    const btn = document.getElementById('btn-loops');
    const row = document.getElementById('loop-row');

    btn.addEventListener('click', () => {
        loopsVisible = !loopsVisible;
        if (loopsVisible) {
            row.classList.remove('loop-row--hidden');
            btn.classList.add('transport-btn--active');
        } else {
            row.classList.add('loop-row--hidden');
            btn.classList.remove('transport-btn--active');
        }
    });

    // Start visible
    btn.classList.add('transport-btn--active');
}

function bindTeachingModeToggle() {
    const btn = document.getElementById('btn-teaching-mode');
    if (!btn) return;

    const setTeachingMode = (enabled) => {
        document.body.classList.toggle('teaching-mode', enabled);
        btn.classList.toggle('transport-btn--teaching-active', enabled);
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        btn.textContent = enabled ? 'Teach On' : 'Teach Off';
        renderFrame();
    };

    setTeachingMode(false);
    btn.addEventListener('click', () => {
        setTeachingMode(!document.body.classList.contains('teaching-mode'));
    });
}


// =============================================================================
// COLLAPSIBLE SECTIONS
// =============================================================================

function bindCollapsibles() {
    document.querySelectorAll('[data-collapsible]').forEach(title => {
        title.addEventListener('click', () => {
            const body = title.nextElementSibling;
            if (!body) return;

            const isCollapsed = title.hasAttribute('data-collapsed');

            if (isCollapsed) {
                // Expand
                title.removeAttribute('data-collapsed');
                body.style.display = '';
                // Restore bottom border/margin
                title.style.marginBottom = '';
                title.style.paddingBottom = '';
                title.style.borderBottom = '';
            } else {
                // Collapse
                title.setAttribute('data-collapsed', '');
                body.style.display = 'none';
            }
        });
    });
}


// =============================================================================
// SLIDER BINDINGS
// =============================================================================

function bindSlider(id, callback) {
    const slider = document.getElementById(id);
    if (!slider) return;
    slider.addEventListener('input', () => callback(slider));
}

function onVtChange(slider) {
    const vtMl = parseInt(slider.value);
    vent.tidalVolume = vtMl / 1000;
    document.getElementById('vt-display').textContent = `${vtMl} mL`;
}

function onPinspChange(slider) {
    const pinsp = parseInt(slider.value);
    vent.inspiratoryPressure = pinsp;
    document.getElementById('pinsp-display').textContent = `${pinsp} cmH₂O`;
}

function onRrChange(slider) {
    const rr = parseInt(slider.value);
    vent.respiratoryRate = rr;
    document.getElementById('rr-display').textContent = `${rr} /min`;
}

function onPeepChange(slider) {
    const peep = parseInt(slider.value);
    vent.peep = peep;
    document.getElementById('peep-display').textContent = `${peep} cmH₂O`;
}

function onFio2Change(slider) {
    const fio2 = parseInt(slider.value);
    vent.fio2 = fio2 / 100;
    document.getElementById('fio2-display').textContent = `${fio2}%`;
}

function onComplianceChange(slider) {
    const cMl = parseInt(slider.value);
    lung.compliance = cMl / 1000;
    document.getElementById('compliance-display').textContent = `${cMl} mL/cmH₂O`;
}

function onResistanceChange(slider) {
    const r = parseInt(slider.value);
    lung.resistance = r;
    document.getElementById('resistance-display').textContent = `${r} cmH₂O·s/L`;
}

function bindPresetSelector() {
    const select = document.getElementById('preset');
    select.addEventListener('change', () => {
        const presetName = select.value;
        const presets = LungModel.presets();
        const preset = presets[presetName];
        if (!preset) return;
        lung.resistance = preset.resistance;
        lung.compliance = preset.compliance;

        document.getElementById('compliance').value = Math.round(preset.compliance * 1000);
        document.getElementById('resistance').value = Math.round(preset.resistance);
        document.getElementById('compliance-display').textContent =
            `${Math.round(preset.compliance * 1000)} mL/cmH₂O`;
        document.getElementById('resistance-display').textContent =
            `${Math.round(preset.resistance)} cmH₂O·s/L`;
    });
}

function bindIEButtons() {
    const group = document.getElementById('ie-group');
    group.addEventListener('click', (e) => {
        const btn = e.target.closest('.ie-btn');
        if (!btn) return;
        const parts = btn.dataset.ie.split(',').map(Number);
        currentIE = parts;
        vent.ieRatio = parts;
        group.querySelectorAll('.ie-btn').forEach(b => b.classList.remove('ie-btn--active'));
        btn.classList.add('ie-btn--active');
        document.getElementById('ie-display').textContent = `1:${(parts[1] / parts[0]).toFixed(1)}`;
    });
}


// =============================================================================
// PARAMETER PANEL
// =============================================================================

function updateParams() {
    const s = vent.summary();
    const m = sim.breathSummary;

    setText('param-pip',     m.pip > 0 ? `${m.pip}` : `${s.pressures.pip_cmH2O}`);
    setText('param-pplat',   `${s.pressures.pplat_cmH2O}`);
    setText('param-map',     `${s.pressures.map_cmH2O}`);
    setText('param-dp',      `${s.pressures.drivingPressure}`);
    setText('param-pr',      `${s.pressures.resistivePressure}`);

    if (s.isPC) setText('param-pinsp', `${s.pressures.inspiratoryPressure}`);

    setText('param-peep-set',   `${s.pressures.peep_cmH2O}`);
    setText('param-auto-peep',  `${s.pressures.autoPeep_cmH2O}`);
    setText('param-total-peep', `${s.pressures.totalPeep_cmH2O}`);

    const displayVt = m.vt_mL > 0 ? m.vt_mL : s.volumes.tidalVolume_mL;
    setText('param-vt',   `${Math.round(displayVt)}`);
    setText('param-rr',   `${s.settings.respiratoryRate}`);
    setText('param-ve',   `${s.volumes.minuteVentilation}`);
    setText('param-flow', `${s.timing.inspFlow_Lpm}`);

    setText('param-ti',     `${s.timing.inspiratoryTime_s}s`);
    setText('param-te',     `${s.timing.expiratoryTime_s}s`);
    setText('param-te-tau', `${s.safety.teOverTau}`);

    if (s.isPC && s.timing.tiOverTau !== null) {
        setText('param-ti-tau', `${s.timing.tiOverTau}`);
    }

    setText('param-crs', `${s.mechanics.compliance * 1000}`);
    setText('param-raw', `${s.mechanics.resistance}`);
    setText('param-tau', `${s.mechanics.timeConstant_s}s`);
    setText('param-ers', `${s.mechanics.elastance}`);

    updateMechanicsBar(s);
    updateAlerts(s, m);
    updateHoldResults(s);
}


// =============================================================================
// BREATH INFO
// =============================================================================

function updateBreathInfo() {
    const m = sim.breathSummary;
    const el = document.getElementById('breath-info');
    if (!el) return;

    const trigTag = m.triggerType === 'patient'
        ? '<span style="color:var(--color-volume)">⬆trig</span>'
        : '<span style="opacity:0.4">mach</span>';

    el.innerHTML = `#${m.breathCount} ${trigTag} · ${m.phase.slice(0, 4)}`;
}


// =============================================================================
// UI HELPERS
// =============================================================================

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function updateMechanicsBar(summary) {
    const bar = document.getElementById('mechanics-bar');
    const s = summary;
    const trappedMl = s.volumes.trappedVolume_mL;
    const teOverTau = s.safety.teOverTau;

    let chips = `
        <span class="mechanics-chip">
            <span class="mechanics-chip__symbol">τ</span>
            ${s.mechanics.timeConstant_s}s
        </span>
        <span class="mechanics-chip" style="color: ${teOverTau < 3 ? 'var(--color-warning)' : 'var(--text-primary)'}">
            <span class="mechanics-chip__symbol">Te/τ</span>
            ${teOverTau}
        </span>`;

    if (s.isPC && s.safety.tiOverTau !== null) {
        chips += `
        <span class="mechanics-chip" style="color: ${s.safety.tiOverTau < 1 ? 'var(--color-warning)' : s.safety.tiOverTau < 3 ? 'var(--color-pressure)' : 'var(--text-primary)'}">
            <span class="mechanics-chip__symbol">Ti/τ</span>
            ${s.safety.tiOverTau}
        </span>`;
    }

    if (s.flowPattern) {
        chips += `
        <span class="mechanics-chip" style="color: ${s.isRamp ? 'var(--color-flow)' : 'var(--text-dim)'}">
            <span class="mechanics-chip__symbol">Flow</span>
            ${s.isRamp ? '╲Ramp' : '▬Sq'}
        </span>`;
    }

    if (s.holdActive) {
        chips += `
        <span class="mechanics-chip" style="color: var(--color-pressure)">
            <span class="mechanics-chip__symbol">Hold</span>
            ${s.timing.holdTime_s}s
        </span>`;
    }

    if (sim.patientRR > 0) {
        chips += `
        <span class="mechanics-chip" style="color: var(--color-volume)">
            <span class="mechanics-chip__symbol">Pmus</span>
            ${vent.pMusMax}·${sim.patientRR}/m
        </span>`;
    }

    chips += `
        <span class="mechanics-chip" style="color: ${trappedMl > 20 ? 'var(--color-warning)' : 'var(--text-primary)'}">
            <span class="mechanics-chip__symbol">Trap</span>
            ${trappedMl < 0.1 ? '<1' : Math.round(trappedMl)} mL
        </span>`;

    bar.innerHTML = chips;
}

function updateAlerts(summary, measured) {
    const container = document.getElementById('alerts');
    const badges = [];
    const s = summary;

    if (s.safety.pplatAbove30) badges.push(makeBadge('danger', `Pplat ${s.pressures.pplat_cmH2O} > 30`));
    if (s.safety.drivingPressureAbove15) badges.push(makeBadge('warning', `ΔP ${s.pressures.drivingPressure} > 15`));
    if (s.safety.gasTrappingRisk) badges.push(makeBadge('warning', `Te/τ ${s.safety.teOverTau} < 3`));
    if (s.pressures.autoPeep_cmH2O > 2) badges.push(makeBadge('warning', `AutoPEEP ${s.pressures.autoPeep_cmH2O}`));
    if (s.safety.tiTooShort) badges.push(makeBadge('warning', `Ti/τ ${s.safety.tiOverTau} < 1 — short fill`));

    if (sim.patientRR > 0 && measured.triggerType === 'patient') {
        badges.push(makeBadge('info', '⬆ Patient triggered'));
    }

    if (badges.length === 0) badges.push(makeBadge('ok', 'No alerts'));
    container.innerHTML = badges.join('');
}

function updateHoldResults(summary) {
    const panel = document.getElementById('hold-results');
    if (!panel) return;
    if (!summary.holdActive) { panel.style.display = 'none'; return; }
    panel.style.display = '';

    const s = summary;
    const pplat = s.pressures.pplat_cmH2O;
    const pip   = s.pressures.pip_cmH2O;

    setText('hold-pplat', pplat.toFixed(1));
    setText('hold-pip-pplat', (pip - pplat).toFixed(1));

    const dp = pplat - s.pressures.totalPeep_cmH2O;
    setText('hold-crs', dp > 0.1 ? (s.volumes.tidalVolume_mL / dp).toFixed(1) : '—');

    if (s.mechanics.measuredResistance !== null) {
        setText('hold-raw', s.mechanics.measuredResistance.toFixed(1));
    }
}

function makeBadge(level, text) {
    return `<span class="alert-badge alert-badge--${level}">${text}</span>`;
}


// =============================================================================
// START
// =============================================================================

document.addEventListener('DOMContentLoaded', init);
