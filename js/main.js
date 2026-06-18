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
import { Ventilator, MODE_PC_CSV }        from './ventilator.js?v=8';
import { SimulationEngine }  from './simulation.js?v=8';
import { WaveformDisplay, LoopRenderer }   from './waveforms.js?v=8';
import AlarmEngine from '../alarms.js?v=8';
import {
    DEFAULT_ALARM_AUDIO_SETTINGS,
    alarmSignature,
    highestPriority,
    shouldPlayAlarmSound,
} from '../alarm-audio.js?v=8';


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
const alarmLimits = {
    ...AlarmEngine.DEFAULT_ALARM_LIMITS,
};
let activeAlarms = [];
const alarmAudioSettings = {
    ...DEFAULT_ALARM_AUDIO_SETTINGS,
};
const alarmAudioState = {
    enabled: alarmAudioSettings.enabled,
    silencedUntilSec: 0,
    lastSoundAtSec: -Infinity,
    lastAlarmSignature: '',
    audioContext: null,
    armed: false,
};


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
        psPressure:          10,
        cyclePercent:        25,
        respiratoryRate:     14,
        ieRatio:             [1, 2],
        peep:                5,
        fio2:                0.40,
        triggerType:         'flow',
        flowTriggerLpm:      2.0,
        pressureTriggerCmH2O: 1.0,
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

    ensurePcCsvModeOption();
    ensurePcCsvControls();
    syncMonitorLayout();

    // --- Bind all controls ---
    bindSlider('vt',            onVtChange);
    bindSlider('rr',            onRrChange);
    bindSlider('pinsp',         onPinspChange);
    bindSlider('ps-pressure',   onPsPressureChange);
    bindSlider('cycle-percent', onCyclePercentChange);
    bindSlider('peep',          onPeepChange);
    bindSlider('fio2',          onFio2Change);
    bindSlider('compliance',    onComplianceChange);
    bindSlider('resistance',    onResistanceChange);
    bindSlider('hold-duration', onHoldDurationChange);
    bindSlider('pmus-max',      onPmusMaxChange);
    bindSlider('neural-ti',     onNeuralTiChange);
    bindSlider('patient-rr',    onPatientRRChange);
    bindSlider('flow-trigger',     onFlowTriggerChange);
    bindSlider('pressure-trigger', onPressureTriggerChange);
    bindSlider('alarm-high-pressure', onAlarmHighPressureChange);
    bindSlider('alarm-high-rr',       onAlarmHighRRChange);
    bindSlider('alarm-apnea',         onAlarmApneaChange);
    bindSlider('alarm-low-ve',        onAlarmLowVeChange);
    bindSlider('alarm-high-ve',       onAlarmHighVeChange);

    bindPresetSelector();
    bindIEButtons();
    bindModeToggle();
    bindFlowPatternToggle();
    bindHoldToggle();
    bindPmusToggle();
    bindTriggerTypeToggle();
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

    applyModeUI(vent.mode);
    updateTriggerDisplay();
    initializeAlarmControls();
    bindAlarmAudioControls();
    updateAlarmAudioControls(activeAlarms, 0);

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

function ensurePcCsvModeOption() {
    const group = document.getElementById('mode-toggle');
    if (!group || group.querySelector(`[data-mode="${MODE_PC_CSV}"]`)) return;

    const btn = document.createElement('button');
    btn.className = 'mode-btn';
    btn.dataset.mode = MODE_PC_CSV;
    btn.textContent = 'PC-CSV';
    group.appendChild(btn);
}

function ensurePcCsvControls() {
    const pinspControl = document.getElementById('pinsp-control');
    if (!pinspControl) return;

    if (!document.getElementById('ps-control')) {
        pinspControl.insertAdjacentHTML('afterend', `
            <div class="control control--primary control--hidden" id="ps-control">
                <div class="control__header">
                    <span class="control__label">Pressure Support</span>
                    <span class="control__value" id="ps-pressure-display">${vent.psPressure} cmH2O</span>
                </div>
                <input type="range" class="control__range" id="ps-pressure"
                       min="5" max="30" step="1" value="${vent.psPressure}">
            </div>
            <div class="control control--secondary control--hidden" id="cycle-percent-control">
                <div class="control__header">
                    <span class="control__label">Cycle %</span>
                    <span class="control__value" id="cycle-percent-display">${vent.cyclePercent}%</span>
                </div>
                <input type="range" class="control__range" id="cycle-percent"
                       min="10" max="60" step="1" value="${vent.cyclePercent}">
            </div>
        `);
    }
}

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
    const isPressureMode = mode !== 'vc-cmv';
    const isCsv = mode === MODE_PC_CSV;
    updateModeLabel();

    const vtControl      = document.getElementById('vt-control');
    const pinspControl   = document.getElementById('pinsp-control');
    const psControl      = document.getElementById('ps-control');
    const cycleControl   = document.getElementById('cycle-percent-control');
    const patternControl = document.getElementById('flow-pattern-control');
    const rrControl      = document.getElementById('rr')?.closest('.control');
    const pinspParamRow  = document.getElementById('pinsp-param-row');
    const pinspParamLabel = pinspParamRow?.querySelector('.param-row__label');

    if (isPressureMode) {
        vtControl.classList.add('control--hidden');
        patternControl.classList.add('control--hidden');
    } else {
        vtControl.classList.remove('control--hidden');
        patternControl.classList.remove('control--hidden');
    }

    pinspControl.classList.toggle('control--hidden', mode !== 'pc-cmv');
    if (psControl) psControl.classList.toggle('control--hidden', !isCsv);
    if (cycleControl) cycleControl.classList.toggle('control--hidden', !isCsv);
    if (rrControl) rrControl.style.display = isCsv ? 'none' : '';

    if (pinspParamRow) pinspParamRow.style.display = isPressureMode ? '' : 'none';
    document.getElementById('ti-tau-row').style.display = mode === 'pc-cmv' ? '' : 'none';

    if (pinspParamLabel) {
        pinspParamLabel.innerHTML = isCsv ? 'P<sub>sup</sub>' : 'P<sub>insp</sub>';
    }

    document.getElementById('vt-param-label').innerHTML = isPressureMode
        ? 'V<sub>T</sub> <span style="font-size:9px;opacity:0.5">(del)</span>'
        : 'V<sub>T</sub>';

    updateFlowLabel();

    document.getElementById('resist-label').innerHTML = isPressureMode
        ? 'ΔP<sub>eff</sub>' : 'P<sub>resist</sub>';

    updateHoldResultsVisibility();
    updateHoldControlState(isCsv);
}

function updateModeLabel() {
    const modeLabel = document.getElementById('mode-label');
    const isPC = vent.isPressureMode();
    const isCsv = vent.isSpontaneousMode();

    let tag = 'set-point';
    if (isCsv) tag = 'flow-cycled';
    else if (!isPC && vent.flowPattern === 'ramp') tag = 'ramp';

    const holdTag = vent.holdActive
        ? '<span style="color:var(--color-pressure); margin-left:4px; font-size:10px;">⏸ HOLD</span>' : '';

    const pmusTag = sim.patientRR > 0
        ? '<span style="color:var(--color-volume); margin-left:4px; font-size:10px;">💪 EFFORT</span>' : '';

    const modeName = vent.modeLabel;
    modeLabel.innerHTML = `${modeName}<span style="font-weight:normal; font-size:11px; opacity:0.5; margin-left:4px;">${tag}</span>${holdTag}${pmusTag}`;
}

function updateFlowLabel() {
    const label = document.getElementById('flow-param-label');
    if (vent.isPressureMode()) label.innerHTML = 'V̇<sub>peak</sub>';
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
        const showRaw = vent.holdActive && !vent.isPressureMode() && vent.flowPattern !== 'ramp';
        rawRow.style.display = showRaw ? '' : 'none';
    }
}

function updateHoldControlState(isSpontaneous) {
    const btn      = document.getElementById('hold-toggle');
    const slider   = document.getElementById('hold-duration');
    if (isSpontaneous) {
        // Engine already suppresses hold in spontaneous modes (effectiveHoldTime → 0).
        // Reset any stale operator intent and lock the UI to match.
        vent.holdTime = 0;
        btn.disabled  = true;
        btn.classList.remove('hold-btn--active');
        document.getElementById('hold-icon').textContent      = '▶';
        document.getElementById('hold-btn-label').textContent = 'Activate';
        document.getElementById('hold-display').textContent   = 'Off';
        document.getElementById('hold-duration-group').style.display = 'none';
        document.getElementById('hold-results').style.display        = 'none';
        if (slider) slider.disabled = true;
        btn.title = 'Inspiratory hold is a passive-mechanics measurement; not available in spontaneous modes';
    } else {
        btn.disabled = false;
        if (slider) slider.disabled = false;
        btn.title = '';
    }
}


// =============================================================================
// PATIENT EFFORT + PATIENT RR
// =============================================================================

function formatPmusValue(value) {
    return `${Number(value).toFixed(2).replace(/\.?0+$/, '')} cmH₂O`;
}

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
            const pmax = parseFloat(document.getElementById('pmus-max').value);
            const nti  = parseInt(document.getElementById('neural-ti').value) / 10;
            const prr  = parseInt(document.getElementById('patient-rr').value);
            vent.pMusMax  = pmax;
            vent.neuralTi = nti;
            sim.patientRR = prr;

            btn.classList.add('hold-btn--active');
            document.getElementById('pmus-icon').textContent = '💪';
            document.getElementById('pmus-btn-label').textContent = 'Active';
            document.getElementById('pmus-display').textContent = formatPmusValue(pmax);
            document.getElementById('pmus-sliders').style.display = '';
            document.getElementById('patient-rr-control').style.display = '';
        }
        updateModeLabel();
    });
}

function onPmusMaxChange(slider) {
    const pmax = parseFloat(slider.value);
    vent.pMusMax = pmax;
    document.getElementById('pmus-max-display').textContent = formatPmusValue(pmax);
    document.getElementById('pmus-display').textContent = formatPmusValue(pmax);
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

function onAlarmHighPressureChange(slider) {
    const value = parseFloat(slider.value);
    alarmLimits.highPressureCmH2O = value;
    setText('alarm-high-pressure-display', `${value.toFixed(0)} cmH₂O`);
}

function onAlarmHighRRChange(slider) {
    const value = parseFloat(slider.value);
    alarmLimits.highRR = value;
    setText('alarm-high-rr-display', `${value.toFixed(0)} /min`);
}

function onAlarmApneaChange(slider) {
    const value = parseFloat(slider.value);
    alarmLimits.apneaSeconds = value;
    setText('alarm-apnea-display', `${value.toFixed(0)} s`);
}

function onAlarmLowVeChange(slider) {
    const value = parseFloat(slider.value);
    alarmLimits.lowMinuteVentilationLpm = value;
    setText('alarm-low-ve-display', `${value.toFixed(1)} L/min`);
}

function onAlarmHighVeChange(slider) {
    const value = parseFloat(slider.value);
    alarmLimits.highMinuteVentilationLpm = value;
    setText('alarm-high-ve-display', `${value.toFixed(1)} L/min`);
}

function initializeAlarmControls() {
    const highPressure = document.getElementById('alarm-high-pressure');
    const highRR = document.getElementById('alarm-high-rr');
    const apnea = document.getElementById('alarm-apnea');
    const lowVe = document.getElementById('alarm-low-ve');
    const highVe = document.getElementById('alarm-high-ve');

    if (highPressure) highPressure.value = `${alarmLimits.highPressureCmH2O}`;
    if (highRR) highRR.value = `${alarmLimits.highRR}`;
    if (apnea) apnea.value = `${alarmLimits.apneaSeconds}`;
    if (lowVe) lowVe.value = `${alarmLimits.lowMinuteVentilationLpm}`;
    if (highVe) highVe.value = `${alarmLimits.highMinuteVentilationLpm}`;

    setText('alarm-high-pressure-display', `${alarmLimits.highPressureCmH2O.toFixed(0)} cmH₂O`);
    setText('alarm-high-rr-display', `${alarmLimits.highRR.toFixed(0)} /min`);
    setText('alarm-apnea-display', `${alarmLimits.apneaSeconds.toFixed(0)} s`);
    setText('alarm-low-ve-display', `${alarmLimits.lowMinuteVentilationLpm.toFixed(1)} L/min`);
    setText('alarm-high-ve-display', `${alarmLimits.highMinuteVentilationLpm.toFixed(1)} L/min`);
}

function bindAlarmAudioControls() {
    const silenceBtn = document.getElementById('alarm-silence-btn');
    const muteBtn = document.getElementById('alarm-mute-btn');

    if (silenceBtn) {
        silenceBtn.addEventListener('click', () => {
            armAlarmAudio();

            const nowSec = getAlarmNowSec();
            alarmAudioState.silencedUntilSec =
                nowSec + alarmAudioSettings.silenceDurationSec;

            updateAlarmAudioControls(activeAlarms, nowSec);
        });
    }

    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            armAlarmAudio();
            alarmAudioState.enabled = !alarmAudioState.enabled;
            if (alarmAudioState.enabled) {
                alarmAudioState.lastSoundAtSec = -Infinity;
            }
            updateAlarmAudioControls(activeAlarms, getAlarmNowSec());
        });
    }
}

function armAlarmAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!alarmAudioState.audioContext) {
        try {
            alarmAudioState.audioContext = new AudioContextClass();
        } catch (_error) {
            return;
        }
    }

    alarmAudioState.armed = true;

    if (
        alarmAudioState.audioContext.state === 'suspended' &&
        typeof alarmAudioState.audioContext.resume === 'function'
    ) {
        alarmAudioState.audioContext.resume().catch(() => {});
    }
}

function playTone({
    frequency = 880,
    durationSec = 0.12,
    delaySec = 0,
    volume = 0.25,
    type = 'sine',
}) {
    const ctx = alarmAudioState.audioContext;
    if (!ctx) return;

    const start = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
    };

    osc.start(start);
    osc.stop(start + durationSec + 0.02);
}

function playAlarmSound(priority) {
    const ctx = alarmAudioState.audioContext;
    if (!alarmAudioState.armed || !ctx) return false;

    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(() => {});
        return false;
    }

    if (priority === 'high') {
        // Square-wave triplet: harsh timbre, higher pitch, tight 0.15 s spacing.
        playTone({ frequency: 880, durationSec: 0.10, delaySec: 0, type: 'square' });
        playTone({ frequency: 988, durationSec: 0.10, delaySec: 0.15, type: 'square' });
        playTone({ frequency: 880, durationSec: 0.10, delaySec: 0.30, type: 'square' });
    } else {
        // Sine 2-note descending chime: calm timbre, lower pitch, relaxed 0.25 s spacing.
        playTone({ frequency: 660, durationSec: 0.12, delaySec: 0, volume: 0.18, type: 'sine' });
        playTone({ frequency: 550, durationSec: 0.14, delaySec: 0.25, volume: 0.18, type: 'sine' });
    }

    return true;
}

function formatTriggerValue(value, unit) {
    return `${Number(value).toFixed(1)} ${unit}`;
}

function updateTriggerDisplay() {
    const type = vent.triggerType ?? 'flow';

    const flowRow = document.getElementById('flow-trigger-row');
    const pressureRow = document.getElementById('pressure-trigger-row');
    const group = document.getElementById('trigger-type-group');
    const flowDisplay = document.getElementById('flow-trigger-display');
    const pressureDisplay = document.getElementById('pressure-trigger-display');

    if (flowRow) flowRow.style.display = type === 'flow' ? '' : 'none';
    if (pressureRow) pressureRow.style.display = type === 'pressure' ? '' : 'none';

    if (group) {
        group.querySelectorAll('[data-trigger-type]').forEach((button) => {
            button.classList.toggle('ie-btn--active', button.dataset.triggerType === type);
        });
    }

    if (flowDisplay) {
        flowDisplay.textContent = formatTriggerValue(vent.flowTriggerLpm, 'L/min');
    }
    if (pressureDisplay) {
        pressureDisplay.textContent = formatTriggerValue(vent.pressureTriggerCmH2O, 'cmH₂O');
    }

    const label = type === 'pressure'
        ? `Pressure ${formatTriggerValue(vent.pressureTriggerCmH2O, 'cmH₂O')}`
        : `Flow ${formatTriggerValue(vent.flowTriggerLpm, 'L/min')}`;

    const display = document.getElementById('trigger-display');
    if (display) display.textContent = label;
}

function bindTriggerTypeToggle() {
    const group = document.getElementById('trigger-type-group');
    if (!group) return;

    group.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-trigger-type]');
        if (!btn) return;

        vent.triggerType = btn.dataset.triggerType;
        updateTriggerDisplay();
    });
}

function onFlowTriggerChange(slider) {
    const value = parseFloat(slider.value);
    vent.flowTriggerLpm = value;
    document.getElementById('flow-trigger-display').textContent =
        formatTriggerValue(value, 'L/min');
    updateTriggerDisplay();
}

function onPressureTriggerChange(slider) {
    const value = parseFloat(slider.value);
    vent.pressureTriggerCmH2O = value;
    document.getElementById('pressure-trigger-display').textContent =
        formatTriggerValue(value, 'cmH₂O');
    updateTriggerDisplay();
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
        if (enabled) {
            // Default loops OFF when entering Teaching Mode (big-waveform layout)
            const loopRow = document.getElementById('loop-row');
            const loopBtn = document.getElementById('btn-loops');
            loopsVisible = false;
            loopRow.classList.add('loop-row--hidden');
            loopBtn.classList.remove('transport-btn--active');
        }
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

function onPsPressureChange(slider) {
    const ps = parseInt(slider.value);
    vent.psPressure = ps;
    document.getElementById('ps-pressure-display').textContent = `${ps} cmH2O`;
}

function onCyclePercentChange(slider) {
    const cyclePercent = parseInt(slider.value);
    vent.cyclePercent = cyclePercent;
    document.getElementById('cycle-percent-display').textContent = `${cyclePercent}%`;
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

function updateRRDisplay(summary) {
    const rrEl = document.getElementById('param-rr');
    if (!rrEl) return;

    const rrActualSource =
        Number.isFinite(sim?.measuredRR) ? sim.measuredRR :
        Number.isFinite(sim?.measuredRespiratoryRate) ? sim.measuredRespiratoryRate :
        Number.isFinite(summary?.measuredRR) ? summary.measuredRR :
        Number.isFinite(summary?.timing?.measuredRR) ? summary.timing.measuredRR :
        Number.isFinite(summary?.timing?.rrActual) ? summary.timing.rrActual :
        Number.isFinite(summary?.safety?.measuredRR) ? summary.safety.measuredRR :
        Number.isFinite(vent?.respiratoryRate) ? vent.respiratoryRate :
        0;

    const rrActual = Math.round(rrActualSource);
    const rrSet = vent.isSpontaneousMode() ? '—' : `${vent.respiratoryRate}`;

    if (document.body.classList.contains('teaching-mode')) {
        // PR4b — dual-rate readout (display only; reads values the engine already
        // computes). Set = backup machine rate; Delivered = sim.measuredRR;
        // Patient = sim.patientRR (— when effort is off, so it reads "no effort").
        const effortOn = Number.isFinite(sim?.patientRR) && sim.patientRR > 0
            && Number.isFinite(vent?.pMusMax) && vent.pMusMax > 0;
        const rrPatient = effortOn ? Math.round(sim.patientRR) : '—';
        const patientClass = effortOn ? 'rr-triple__num--patient' : 'rr-triple__num--off';
        const html =
            '<span class="rr-triple">' +
              '<span class="rr-triple__line rr-triple__set" title="Set backup rate — mandatory (machine-triggered) breaths/min">' +
                '<span class="rr-triple__lbl">Set</span>' +
                `<span class="rr-triple__num">${rrSet}</span>` +
              '</span>' +
              '<span class="rr-triple__line rr-triple__outputs">' +
                '<span class="rr-triple__cell" title="Delivered rate — breaths actually completed (f = 60/TCT)">' +
                  '<span class="rr-triple__lbl">Delivered</span>' +
                  `<span class="rr-triple__num rr-triple__num--delivered">${rrActual}</span>` +
                '</span>' +
                '<span class="rr-triple__cell" title="Patient effort rate (Pmus) — what the patient is asking for; may exceed delivered if efforts fail to trigger">' +
                  '<span class="rr-triple__lbl">Patient</span>' +
                  `<span class="rr-triple__num ${patientClass}">${rrPatient}</span>` +
                '</span>' +
              '</span>' +
            '</span>';
        // Rebuild ONLY when the rendered content changes. updateRRDisplay runs
        // every animation frame; reassigning innerHTML each frame was destroying
        // the title-bearing cells ~60×/s, so the native tooltip's hover-dwell
        // timer never completed (the title attrs were present, the nodes weren't
        // stable). Guarding keeps the DOM stable so the Set/Delivered/Patient
        // tooltips surface on hover. `haveTriple` also forces a rebuild after a
        // standard-mode (textContent) render replaced the structure.
        const haveTriple = rrEl.firstElementChild
            && rrEl.firstElementChild.classList.contains('rr-triple');
        if (!haveTriple || html !== rrEl._rrTripleHtml) {
            rrEl.innerHTML = html;
            rrEl._rrTripleHtml = html;
        }
        return;
    }

    rrEl.textContent = `${rrActual}`;
}

function updateParams() {
    const summary = vent.summary();
    const s = summary;
    const m = sim.breathSummary;
    const isCsv = vent.isSpontaneousMode();
    const measuredRR = Number.isFinite(sim.measuredRR) ? sim.measuredRR : 0;
    const rrSet = isCsv ? '—' : `${vent.respiratoryRate}`;
    setText('param-pip',     m.pip > 0 ? `${m.pip}` : `${s.pressures.pip_cmH2O}`);
    setText('param-pplat',   `${s.pressures.pplat_cmH2O}`);
    setText('param-map',     `${s.pressures.map_cmH2O}`);
    setText('param-dp',      `${s.pressures.drivingPressure}`);
    setText('param-pr',      `${s.pressures.resistivePressure}`);

    if (s.isPC) setText('param-pinsp', `${s.pressures.inspiratoryPressure}`);

    setText('param-peep-set',   `${s.pressures.peep_cmH2O}`);
    setText('param-auto-peep',  `${s.pressures.autoPeep_cmH2O}`);
    setText('param-total-peep', `${s.pressures.totalPeep_cmH2O}`);

    const displayVt = isCsv
        ? m.vt_mL
        : (m.vt_mL > 0 ? m.vt_mL : s.volumes.tidalVolume_mL);
    const displayVe = isCsv
        ? Math.round((displayVt / 1000) * measuredRR * 10) / 10
        : s.volumes.minuteVentilation;
    const displayFlow = isCsv && m.peakFlow_Lpm > 0
        ? m.peakFlow_Lpm
        : s.timing.inspFlow_Lpm;

    setText('param-vt',   `${Math.round(displayVt)}`);
    updateRRDisplay(s);
    setText('param-ve',   `${displayVe}`);
    setText('param-flow', `${displayFlow}`);

    setText('param-ti',     `${s.timing.inspiratoryTime_s}s`);
    setText('param-te',     `${s.timing.expiratoryTime_s}s`);
    setText('param-te-tau', `${s.safety.teOverTau}`);
    setText('param-exp-completion', `${Math.round(s.safety.expiratoryCompletionPercent)}%`);

    const expCompletionEl = document.getElementById('param-exp-completion');
    if (expCompletionEl) {
        expCompletionEl.classList.remove('ok', 'warn', 'danger');

        if (s.safety.expiratoryCompletionStatus === 'complete') {
            expCompletionEl.classList.add('ok');
        } else if (s.safety.expiratoryCompletionStatus === 'borderline') {
            expCompletionEl.classList.add('warn');
        } else {
            expCompletionEl.classList.add('danger');
        }
    }

    if (s.isPC && s.timing.tiOverTau !== null) {
        setText('param-ti-tau', `${s.timing.tiOverTau}`);
    }

    setText('param-crs', `${s.mechanics.compliance * 1000}`);
    setText('param-raw', `${s.mechanics.resistance}`);
    setText('param-tau', `${s.mechanics.timeConstant_s}s`);
    setText('param-ers', `${s.mechanics.elastance}`);

    const alarmMetrics = getCurrentAlarmMetrics(summary);
    activeAlarms = AlarmEngine.evaluateAlarms(alarmMetrics, alarmLimits);
    renderAlarms(activeAlarms);
    // AUDIO policy runs on wall-clock (getAlarmNowSec), NOT the sim-time used for
    // evaluation above: alarm-audio timers must survive sim.reset() and stay
    // real-time under speed/pause (SME-008), and stay consistent with
    // silencedUntilSec (also set from getAlarmNowSec). Do not re-couple these.
    const audioNowSec = getAlarmNowSec();
    updateAlarmAudio(activeAlarms, audioNowSec);
    updateAlarmAudioControls(activeAlarms, audioNowSec);

    updateTeachingIndicators();
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

    let trigTag = '<span style="opacity:0.4">mach</span>';
    if (vent.isSpontaneousMode() && m.breathCount === 0) {
        trigTag = '<span style="opacity:0.4">wait</span>';
    } else if (m.triggerType === 'patient') {
        trigTag = '<span style="color:var(--color-volume)">trig</span>';
    }

    el.innerHTML = `#${m.breathCount} ${trigTag} | ${m.phase.slice(0, 4)}`;
}

function getAlarmNowSec() {
    // Wall-clock real seconds (monotonic), NOT sim.globalTime — so alarm-audio
    // timers survive sim.reset() and stay real-time under speed/pause (SME-008).
    return performance.now() / 1000;
}

function getCurrentAlarmMetrics(summary) {
    const pressures = summary?.pressures ?? {};
    const volumes = summary?.volumes ?? {};
    const timing = summary?.timing ?? {};
    const safety = summary?.safety ?? {};
    const measured = sim?.breathSummary ?? {};

    // Alarm EVALUATION runs on sim-time: apnea differences this against
    // sim.lastBreathStartSec (sim-time), and sim.reset() zeroes both together, so
    // a mode switch can't read a false "no recent breath" (SME-017). The low-VE
    // stabilization grace (elapsedSec ≥ 5) also re-arms on reset this way. The
    // AUDIO layer deliberately uses a DIFFERENT clock — see updateAlarmAudio below.
    const nowSec = sim?.globalTime ?? 0;

    const lastBreathStartSec =
        sim?.lastBreathStartSec ??
        sim?.lastBreathTimeSec ??
        sim?.breathSummary?.lastBreathStartSec ??
        null;

    const pipCmH2O =
        measured.pip ??
        pressures.pip_cmH2O ??
        pressures.pip ??
        summary?.pip ??
        summary?.PIP ??
        safety.pip;

    const pawCmH2O =
        sim?.currentPressure ??
        sim?.paw ??
        sim?.currentPaw ??
        pipCmH2O;

    const measuredRR =
        sim?.measuredRR ??
        sim?.measuredRespiratoryRate ??
        summary?.measuredRR ??
        timing?.measuredRR ??
        timing?.rrActual ??
        safety?.measuredRR;

    const deliveredVtL =
        Number.isFinite(measured.vt_mL) && measured.vt_mL > 0
            ? measured.vt_mL / 1000
            : Number.isFinite(volumes.tidalVolume_mL) && volumes.tidalVolume_mL > 0
                ? volumes.tidalVolume_mL / 1000
                : null;

    const minuteVentilationLpm =
        Number.isFinite(measuredRR) && Number.isFinite(deliveredVtL) && deliveredVtL > 0
            ? Math.round(deliveredVtL * measuredRR * 10) / 10
            : volumes.minuteVentilation ??
              volumes.minuteVentilationLpm ??
              volumes.ve ??
              volumes.VE ??
              summary?.minuteVentilation ??
              summary?.ve ??
              summary?.VE;

    return {
        nowSec,
        elapsedSec: nowSec,
        lastBreathStartSec,
        pipCmH2O,
        pawCmH2O,
        measuredRR,
        minuteVentilationLpm,
    };
}

function inferredComparator(alarm) {
    if (alarm?.id === 'LOW_VE') return '<';
    if (alarm?.id === 'HIGH_PRESSURE') return '>';
    if (alarm?.id === 'HIGH_RR') return '>';
    if (alarm?.id === 'HIGH_VE') return '>';
    if (alarm?.id === 'APNEA') return '>';
    return '>';
}

function formatAlarmNumber(value) {
    if (!Number.isFinite(value)) return '';

    if (Math.abs(value - Math.round(value)) < 0.05) {
        return `${Math.round(value)}`;
    }

    return value.toFixed(1);
}

function formatAlarmChipText(alarm) {
    const value = Number.isFinite(alarm?.value) ? Number(alarm.value) : null;
    const limit = Number.isFinite(alarm?.limit) ? Number(alarm.limit) : null;
    const comparator = alarm?.comparator ?? inferredComparator(alarm);

    if (alarm?.id === 'HIGH_PRESSURE' || alarm?.id === 'APNEA') {
        return alarm.label;
    }

    if (value !== null && limit !== null) {
        return `${alarm.label} ${formatAlarmNumber(value)} ${comparator} ${formatAlarmNumber(limit)}`;
    }

    return alarm?.label ?? 'Alarm';
}

function renderAlarms(alarms) {
    const banner = document.getElementById('alarm-banner');
    const chipList = document.getElementById('alarm-chip-list');

    if (!banner || !chipList) return;

    banner.classList.remove(
        'alarm-banner--ok',
        'alarm-banner--medium',
        'alarm-banner--high'
    );

    chipList.innerHTML = '';

    if (!alarms || alarms.length === 0) {
        banner.classList.add('alarm-banner--ok');

        const empty = document.createElement('span');
        empty.id = 'alarm-banner-text';
        empty.className = 'alarm-banner__empty';
        empty.textContent = 'No alerts';

        chipList.appendChild(empty);
        banner.title = '';
        return;
    }

    const priority = AlarmEngine.highestAlarmPriority(alarms);
    banner.classList.add(
        priority === 'high' ? 'alarm-banner--high' : 'alarm-banner--medium'
    );

    const priorityRank = { high: 0, medium: 1, low: 2 };
    const sorted = [...alarms].sort((a, b) => {
        const pa = priorityRank[a.priority] ?? 99;
        const pb = priorityRank[b.priority] ?? 99;
        return pa - pb;
    });

    sorted.forEach((alarm) => {
        const chip = document.createElement('span');
        chip.className = `alarm-chip alarm-chip--${alarm.priority || 'medium'}`;
        chip.textContent = formatAlarmChipText(alarm);
        chip.title = alarm.message || alarm.label;
        chipList.appendChild(chip);
    });

    banner.title = sorted
        .map(alarm => alarm.message || alarm.label)
        .join('\n');
}

function updateAlarmAudio(alarms, nowSec) {
    const signature = alarmSignature(alarms);

    const shouldPlay = shouldPlayAlarmSound({
        activeAlarms: alarms,
        nowSec,
        audioEnabled: alarmAudioState.enabled,
        silencedUntilSec: alarmAudioState.silencedUntilSec,
        lastSoundAtSec: alarmAudioState.lastSoundAtSec,
        lastAlarmSignature: alarmAudioState.lastAlarmSignature,
        settings: alarmAudioSettings,
    });

    if (shouldPlay) {
        const priority = highestPriority(alarms);
        if (playAlarmSound(priority)) {
            alarmAudioState.lastSoundAtSec = nowSec;
        }
    }

    alarmAudioState.lastAlarmSignature = signature;

    if (!alarms || alarms.length === 0) {
        alarmAudioState.lastAlarmSignature = '';
    }
}

function updateAlarmAudioControls(alarms = [], nowSec = 0) {
    const silenceBtn = document.getElementById('alarm-silence-btn');
    const muteBtn = document.getElementById('alarm-mute-btn');

    const hasActiveAlarms = alarms && alarms.length > 0;
    const isSilenced = nowSec < alarmAudioState.silencedUntilSec;

    if (silenceBtn) {
        silenceBtn.disabled = !hasActiveAlarms;

        if (isSilenced) {
            const remaining = Math.ceil(alarmAudioState.silencedUntilSec - nowSec);
            silenceBtn.textContent = `Silenced ${remaining}s`;
            silenceBtn.classList.add('alarm-audio-btn--active');
        } else {
            silenceBtn.textContent = 'Silence';
            silenceBtn.classList.remove('alarm-audio-btn--active');
        }
    }

    if (muteBtn) {
        muteBtn.textContent = alarmAudioState.enabled ? 'Sound On' : 'Muted';
        muteBtn.classList.toggle('alarm-audio-btn--muted', !alarmAudioState.enabled);
    }
}

// =============================================================================
// UI HELPERS
// =============================================================================

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function syncMonitorLayout() {
    const timingGroup = document.getElementById('timing-vent-group');
    const timingBody = timingGroup?.querySelector('.param-group__body');
    const peepGroup = document.getElementById('peep-group');
    const rrEl = document.getElementById('param-rr');
    if (!rrEl) {
        console.warn('RR element not found in DOM');
        return;
    }

    const rrRow = rrEl.closest('.param-row');
    const veRow = document.getElementById('param-ve')?.closest('.param-row');
    const vtRow = document.getElementById('param-vt')?.closest('.param-row');

    if (timingGroup && peepGroup && peepGroup.previousElementSibling !== timingGroup) {
        peepGroup.parentNode.insertBefore(timingGroup, peepGroup);
    }

    if (!timingBody) return;

    if (rrRow && rrRow.parentElement !== timingBody) {
        timingBody.insertBefore(rrRow, timingBody.firstChild);
    }

    if (rrRow) {
        rrRow.classList.remove('teaching-only');
    }

    if (veRow) {
        veRow.classList.add('teaching-key');
    }

    if (veRow && vtRow && veRow.nextElementSibling !== vtRow) {
        timingBody.insertBefore(veRow, vtRow);
    }
}

function updateTeachingIndicators() {
    const teachingMode = document.body.classList.contains('teaching-mode');
    const autoPeepEl = document.getElementById('param-auto-peep');
    const expCompletionEl = document.getElementById('param-exp-completion');
    const autoPeepRow = autoPeepEl?.closest('.param-row');
    const expCompletionRow = expCompletionEl?.closest('.param-row');
    const autoPeepLabel = autoPeepRow?.querySelector('.param-row__label');

    if (!autoPeepEl || !expCompletionEl || !autoPeepRow || !expCompletionRow || !autoPeepLabel) {
        return;
    }

    if (teachingMode) {
        const baselineText = sim.flowBaselineReached ? 'Yes' : 'No';
        const percentText = `${Math.round(sim.expFlowReturnPercent)}%`;

        autoPeepLabel.textContent = 'Flow Baseline';
        autoPeepEl.textContent = baselineText;
        autoPeepEl.classList.remove('ok', 'warn', 'danger');
        autoPeepEl.classList.add(sim.flowBaselineReached ? 'ok' : 'danger');
        autoPeepRow.style.display = 'flex';

        expCompletionEl.textContent = percentText;
        expCompletionEl.classList.remove('ok', 'warn', 'danger');
        if (sim.flowBaselineReached) {
            expCompletionEl.classList.add('ok');
        } else if (sim.expFlowReturnPercent >= 90) {
            expCompletionEl.classList.add('warn');
        } else {
            expCompletionEl.classList.add('danger');
        }
        expCompletionRow.style.display = 'flex';
        return;
    }

    autoPeepLabel.textContent = 'Auto-PEEP';
    autoPeepEl.classList.remove('ok', 'warn', 'danger');
    autoPeepRow.style.display = '';
    expCompletionRow.style.display = '';
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
    if (!container) return;

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

document.addEventListener('pointerdown', armAlarmAudio, { once: true });
document.addEventListener('keydown', armAlarmAudio, { once: true });
document.addEventListener('DOMContentLoaded', init);

