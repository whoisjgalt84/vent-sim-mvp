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
 *   The SimulationEngine re-reads settings from the Ventilator EVERY TICK,
 *   not at breath start. Nothing is snapshotted except volumeAtBreathStart.
 *   So VT, RR, I:E, hold, mode, R, C and PEEP all take effect mid-breath.
 *   That is deliberate — it keeps cause and effect adjacent for the learner.
 *
 *   A test-only determinism surface is installed on window.__vsim; see
 *   installTestHooks() at the bottom of this file.
 *
 * ============================================================================
 */

import { LungModel }        from './lung-model.js?v=12';
import { Ventilator, MODE_PC_CSV }        from './ventilator.js?v=12';
import { SimulationEngine }  from './simulation.js?v=12';
import { WaveformDisplay, LoopRenderer }   from './waveforms.js?v=12';
import AlarmEngine from '../alarms.js?v=12';
import {
    DEFAULT_ALARM_AUDIO_SETTINGS,
    alarmSignature,
    highestPriority,
    shouldPlayAlarmSound,
} from '../alarm-audio.js?v=12';


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

// Trailing window for the Teaching-Mode ineffective-effort counter, in seconds.
// Fixed (not tied to the display window) so the number means the same thing at
// every zoom level; matches the engine's triggerEventRetentionSeconds.
const INEFFECTIVE_WINDOW_SEC = 60;
// COPY — pending SME sign-off (see docs/sme-feedback-log.md, SME-016).
const INEFFECTIVE_COUNTER_TOOLTIP =
    'Ineffective efforts — patient attempts in the last 60 s that did not '
    + 'produce a breath, either because the ventilator was mid-breath or '
    + 'because the effort never reached the trigger threshold. This is the gap '
    + 'between Patient and Delivered.';
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
    bindMeasurementHelp();

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

        sim.reset();
        applyModeUI(mode);
        updateMonitorValues(vent.summary());
        updateHoldResults();
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

    setText('vt-param-label', 'Measured VT');

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

    // Mirror the mode into the monitored-value column (SME-013). Same strings as
    // the header — this is a second glance path, not new copy.
    const paramMode = document.getElementById('param-mode');
    if (paramMode) {
        const html = `<span class="param-mode__name">${modeName}</span>`
                   + `<span class="param-mode__tag">${tag}</span>`;
        if (paramMode._modeHtml !== html) {
            paramMode.innerHTML = html;
            paramMode._modeHtml = html;
        }
    }
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
        updateMonitorValues(vent.summary());
        updateHoldResults();
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
        sim.notifyMeasurementSettingsChanged();
        updateModeLabel();
        updateHoldResultsVisibility();
        updateMonitorValues(vent.summary());
        updateHoldResults();
    });
}

function onHoldDurationChange(slider) {
    const dur = parseInt(slider.value) / 10;
    vent.holdTime = dur;
    document.getElementById('hold-duration-display').textContent = `${dur.toFixed(1)}s`;
    document.getElementById('hold-display').textContent = `${dur.toFixed(1)}s`;
    updateMonitorValues(vent.summary());
    updateHoldResults();
}

function updateHoldResultsVisibility() {
    const rawRow = document.getElementById('hold-raw-row');
    if (rawRow) {
        rawRow.style.display = vent.holdActive ? '' : 'none';
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
            setText('pmus-max-display', formatPmusValue(pmax));
            setText('neural-ti-display', `${nti.toFixed(1)} s`);
            document.getElementById('pmus-sliders').style.display = '';
            document.getElementById('patient-rr-control').style.display = '';
        }
        updateModeLabel();
    });
}

function onPmusMaxChange(slider) {
    const pmax = parseFloat(slider.value);
    vent.pMusMax = pmax;
    document.getElementById('pmus-display').textContent = formatPmusValue(pmax);
    // Units beside the slider itself, not only in the collapsed group header —
    // the Effort row was the one control with no inline value at all (SME-002).
    setText('pmus-max-display', formatPmusValue(pmax));
}

function onNeuralTiChange(slider) {
    const nti = parseInt(slider.value) / 10;
    vent.neuralTi = nti;
    document.getElementById('neural-ti-display').textContent = `${nti.toFixed(1)} s`;
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
            // Toggle, not re-arm (SME-018). Pressing Silence while a silence is
            // already running used to extend it by another full duration, with
            // no way to cancel; now a second press clears it. Clearing lets the
            // next frame sound immediately if an alarm is still active, which is
            // the point of cancelling.
            const silenced = nowSec < alarmAudioState.silencedUntilSec;
            alarmAudioState.silencedUntilSec = silenced
                ? 0
                : nowSec + alarmAudioSettings.silenceDurationSec;
            if (silenced) {
                // Clearing silencedUntilSec is not enough to actually restore
                // sound. shouldPlayAlarmSound() still gates on
                // `nowSec - lastSoundAtSec >= repeatSec`, and updateAlarmAudio()
                // keeps lastAlarmSignature current all the way through the
                // silence — so the new-alarm fast path is already spent and the
                // alarm would stay mute for up to a full repeat interval (12 s
                // high, 30 s medium) AFTER the user explicitly cancelled. Same
                // reset the mute toggle does when sound is switched back on.
                alarmAudioState.lastSoundAtSec = -Infinity;
            }

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
        sim.notifyMeasurementSettingsChanged();
        updateTriggerDisplay();
        updateMonitorValues(vent.summary());
        updateHoldResults();
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

    // Waveform time window. Short windows expose within-breath detail (rise time,
    // trigger deflection, flow morphology); long windows expose across-breath
    // patterns (air trapping accumulating, asynchrony recurring). The engine keeps
    // maxDisplaySeconds of history regardless, so widening reveals breaths that
    // already happened instead of blanking the trace.
    const windowGroup = document.getElementById('window-group');
    windowGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.speed-btn');
        if (!btn) return;
        sim.setDisplaySeconds(parseInt(btn.dataset.window, 10));
        windowGroup.querySelectorAll('.speed-btn').forEach(b =>
            b.classList.remove('speed-btn--active'));
        btn.classList.add('speed-btn--active');
        // Redraw now so the change is visible even while paused.
        renderFrame();
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
        // Loops are NOT forced off on entering Teaching Mode any more (SME-012).
        // The old behaviour silently discarded the user's loop choice on the way
        // in and never restored it on the way out, so loops read as unavailable
        // in Teaching Mode even though the button still worked. Loop visibility
        // is now purely the user's, in both modes.
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
    slider.addEventListener('input', () => {
        callback(slider);
        if (!['pmus-max', 'neural-ti', 'patient-rr'].includes(id) && !id.startsWith('alarm-')) {
            sim.notifyMeasurementSettingsChanged();
            updateMonitorValues(vent.summary());
            updateHoldResults();
        }
    });
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
        sim.notifyMeasurementSettingsChanged();

        document.getElementById('compliance').value = Math.round(preset.compliance * 1000);
        document.getElementById('resistance').value = Math.round(preset.resistance);
        document.getElementById('compliance-display').textContent =
            `${Math.round(preset.compliance * 1000)} mL/cmH₂O`;
        document.getElementById('resistance-display').textContent =
            `${Math.round(preset.resistance)} cmH₂O·s/L`;
        updateMonitorValues(vent.summary());
        updateHoldResults();
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
        sim.notifyMeasurementSettingsChanged();
        group.querySelectorAll('.ie-btn').forEach(b => b.classList.remove('ie-btn--active'));
        btn.classList.add('ie-btn--active');
        document.getElementById('ie-display').textContent = `1:${(parts[1] / parts[0]).toFixed(1)}`;
        updateMonitorValues(vent.summary());
        updateHoldResults();
    });
}


// =============================================================================
// PARAMETER PANEL
// =============================================================================

function updateRRDisplay() {
    const rrEl = document.getElementById('param-rr');
    if (!rrEl) return;
    setText('rr-param-label', document.body.classList.contains('teaching-mode')
        ? 'RR' : 'Measured RR');

    const rrActualSource = Number.isFinite(sim.measuredRR) ? sim.measuredRR : 0;

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
        // Ineffective-effort counter (PR4). The Patient-vs-Delivered gap is only
        // half the story — this is the count of efforts that failed to trigger,
        // which is what closes it. Shown whenever effort is on, including at 0,
        // because "0 ineffective" is itself the informative reading.
        const ineffectiveRow = effortOn
            ? '<span class="rr-triple__line rr-triple__ineffective" ' +
                  `title="${INEFFECTIVE_COUNTER_TOOLTIP}">` +
                '<span class="rr-triple__lbl">Ineffective</span>' +
                '<span class="rr-triple__val">' +
                  '<span class="rr-triple__num rr-triple__num--ineffective" ' +
                      'id="rr-ineffective-count">0</span>' +
                  `<span class="rr-triple__unit">/${INEFFECTIVE_WINDOW_SEC}s</span>` +
                '</span>' +
              '</span>'
            : '';
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
              ineffectiveRow +
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
        // The count is written by textContent AFTER the guarded rebuild, and is
        // deliberately kept out of `html`: folding a value that changes on every
        // failed effort into the guarded string would rebuild the whole triple
        // and re-break the tooltip hover-dwell the guard above exists to protect.
        if (effortOn) setText('rr-ineffective-count', `${countIneffectiveEfforts()}`);
        return;
    }

    rrEl.textContent = `${rrActual}`;
}

/**
 * Ineffective (failed) patient efforts in the trailing INEFFECTIVE_WINDOW_SEC.
 *
 * Counts BOTH failure modes the engine records — efforts blocked because the
 * ventilator was mid-breath (`ventilator_unavailable`) and efforts that never
 * crossed the trigger threshold (`threshold`). That matters: only the threshold
 * case bends the expiratory flow trace enough to draw the amber highlight, so
 * the phase-gate failures behind SME-001/004 have no waveform mark at all and
 * this counter is the only place they become visible.
 *
 * The window is fixed at 60 s rather than following the display window, so the
 * number keeps one meaning when the user switches between 5/10/20/30 s. 60 s is
 * also exactly what the engine retains (triggerEventRetentionSeconds).
 */
function countIneffectiveEfforts() {
    if (typeof sim?.getTriggerEvents !== 'function') return 0;
    const now = Number.isFinite(sim.globalTime) ? sim.globalTime : 0;
    return sim.getTriggerEvents(now - INEFFECTIVE_WINDOW_SEC, now)
        .filter((e) => e.type === 'failed').length;
}

// Display-only refresh: mode/reset handlers call this synchronously without
// adding alarm evaluations or advancing the engine (VSM-CLIN-004).
function updateMonitorValues(summary) {
    const s = summary;
    const m = sim.breathSummary;
    const isCsv = vent.isSpontaneousMode();
    const measuredRR = Number.isFinite(sim.measuredRR) ? sim.measuredRR : 0;
    // A breath count marks a START, not completion. Only the finalized record
    // makes per-breath measurements available; neither live nor analytical
    // pressure is a monitor fallback. The live PIP alarm signal is unchanged.
    const completed = sim.lastCompletedBreath;
    const hold = sim.holdMechanics;
    const displayPip = completed !== null ? m.pipLatched : '—';
    setText('param-pip',     `${displayPip}`);
    setText('param-pplat', hold.pplat.value !== null ? `${formatHoldValue(hold.pplat.value)}` : '—');
    setText('pplat-status', holdStatusCopy(hold));
    setText('param-map',     `${s.pressures.map_cmH2O}`);
    setText('param-dp', hold.drivingPressure.value !== null
        ? `${formatHoldValue(hold.drivingPressure.value)}` : '—');
    setText('param-pr',      `${s.pressures.resistivePressure}`);

    if (s.isPC) setText('param-pinsp', `${s.pressures.inspiratoryPressure}`);

    setText('param-peep-set',   `${s.pressures.peep_cmH2O}`);
    setText('param-auto-peep',  `${s.pressures.autoPeep_cmH2O}`);
    setText('param-total-peep', `${s.pressures.totalPeep_cmH2O}`);

    const displayVt = completed !== null ? completed.measuredVT_mL : null;
    const displayVe = isCsv
        ? (displayVt !== null && measuredRR > 0
            ? Math.round((displayVt / 1000) * measuredRR * 10) / 10 : 0)
        : s.volumes.minuteVentilation;
    const displayFlow = isCsv && m.peakFlow_Lpm > 0
        ? m.peakFlow_Lpm
        : s.timing.inspFlow_Lpm;

    setText('param-vt', displayVt !== null ? `${Math.round(displayVt)}` : '—');
    updateRRDisplay();
    setText('param-ve',   `${displayVe}`);
    setText('ve-param-label', isCsv ? 'Delivered VE' : 'Predicted VE');
    // End-expiratory residual immediately BEFORE the current breath began,
    // latched by _startNewBreath and retained throughout that breath, in mL.
    setText('param-live-trapped', `${Math.round(sim.volumeAtBreathStart * 1000)}`);
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

    updateTeachingIndicators();
    updateMechanicsBar(s);
}

function updateParams() {
    const summary = vent.summary();
    const s = summary;
    const m = sim.breathSummary;
    updateMonitorValues(summary);

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

    updateAlerts(s, m);
    updateHoldResults();
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
        // Stay clickable while a silence is running even if the alarm condition
        // has since cleared — otherwise the button greys out mid-countdown and
        // the silence becomes uncancellable, which is the SME-018 complaint in
        // its worst form.
        silenceBtn.disabled = !hasActiveAlarms && !isSilenced;

        if (isSilenced) {
            const remaining = Math.ceil(alarmAudioState.silencedUntilSec - nowSec);
            silenceBtn.textContent = `Silenced ${remaining}s`;
            silenceBtn.title = 'Silence active — click to cancel and restore alarm sound';
            silenceBtn.classList.add('alarm-audio-btn--active');
        } else {
            silenceBtn.textContent = 'Silence';
            silenceBtn.title = 'Silence alarms for 2 minutes';
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

    autoPeepLabel.textContent = 'Predicted steady-state auto-PEEP';
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
        <span class="mechanics-chip mechanics-chip--prediction" style="color: ${trappedMl > 20 ? 'var(--color-warning)' : 'var(--text-primary)'}">
            <span class="mechanics-chip__symbol">Predicted steady-state trapped volume</span>
            ${trappedMl < 0.1 ? '<1' : Math.round(trappedMl)} mL
        </span>`;

    bar.innerHTML = chips;
}

function updateAlerts(summary, measured) {
    const container = document.getElementById('alerts');
    if (!container) return;

    const badges = [];
    const s = summary;

    if (s.safety.pplatAbove30) badges.push(makeBadge('danger', `Predicted Pplat ${s.pressures.pplat_cmH2O} > 30`));
    if (s.safety.drivingPressureAbove15) badges.push(makeBadge('warning', `ΔP ${s.pressures.drivingPressure} > 15`));
    if (s.safety.gasTrappingRisk) badges.push(makeBadge('warning', `Te/τ ${s.safety.teOverTau} < 3`));
    if (s.pressures.autoPeep_cmH2O > 2) badges.push(makeBadge('warning', `Predicted steady-state auto-PEEP ${s.pressures.autoPeep_cmH2O}`));
    if (s.safety.tiTooShort) badges.push(makeBadge('warning', `Ti/τ ${s.safety.tiOverTau} < 1 — short fill`));

    if (sim.patientRR > 0 && measured.triggerType === 'patient') {
        badges.push(makeBadge('info', '⬆ Patient triggered'));
    }

    container.innerHTML = badges.join('');
}

function formatHoldValue(value) {
    return Number.isFinite(value) ? Number(value.toFixed(1)) : '—';
}

function holdStatusCopy(hold) {
    const reasons = hold?.reasons ?? [];
    if (hold?.status === 'valid') return '';
    if (reasons.includes('HOLD_INAPPLICABLE_MODE')) return 'Unavailable in PC-CSV';
    if (reasons.includes('SETTINGS_CHANGED')) return 'Settings changed';
    if (reasons.includes('HOLD_RESULT_CLEARED') || reasons.includes('AWAITING_COMPLETED_HOLD')) return 'Awaiting hold';
    if (reasons.includes('NO_HOLD')) return 'No hold result';
    if (reasons.includes('HOLD_INTERRUPTED')) return 'Hold interrupted';
    if (reasons.includes('HOLD_TOO_SHORT') || reasons.includes('INSUFFICIENT_SAMPLES')) return 'Hold too short';
    if (reasons.includes('HOLD_TOO_LONG')) return 'Unsupported duration';
    if (reasons.includes('EFFORT_DURING_HOLD')) return 'Effort during hold';
    if (reasons.includes('NONZERO_HOLD_FLOW')) return 'Nonzero hold flow';
    if (reasons.includes('PRESSURE_UNSTABLE')) return 'Pressure unstable';
    return 'Measurement unavailable';
}

function detailedHoldStatusCopy(result) {
    const reasons = result?.reasons ?? [];
    if (result?.status === 'valid') return 'Valid Pplat measurement.';
    if (reasons.includes('HOLD_INAPPLICABLE_MODE')) return 'Hold measurements unavailable in PC-CSV.';
    if (reasons.includes('SETTINGS_CHANGED')) return 'Settings changed. Awaiting a new completed hold.';
    if (reasons.includes('HOLD_RESULT_CLEARED')) return 'Hold result cleared. Awaiting a completed hold.';
    if (reasons.includes('NO_HOLD')) return 'No completed hold result.';
    if (reasons.includes('AWAITING_COMPLETED_HOLD')) return 'Awaiting a completed hold.';
    if (reasons.includes('HOLD_INTERRUPTED')) return 'Hold interrupted. No measurement.';
    if (reasons.includes('HOLD_TOO_SHORT') || reasons.includes('INSUFFICIENT_SAMPLES')) {
        return 'Measurement unavailable: hold shorter than 0.5 s. The 0.5–2 s range is this simulator’s measurement criterion.';
    }
    if (reasons.includes('HOLD_TOO_LONG')) return 'Hold duration outside the supported range.';
    if (reasons.includes('EFFORT_DURING_HOLD')) return 'Unavailable: effort during hold.';
    if (reasons.includes('NONZERO_HOLD_FLOW')) return 'Unavailable: nonzero flow during hold.';
    if (reasons.includes('PRESSURE_UNSTABLE')) return 'Unavailable: pressure unstable during hold.';
    return 'Measurement unavailable.';
}

function resistanceStatusCopy(result, pplatResult) {
    if (pplatResult?.status !== 'valid') return '';
    if (result.status === 'valid') return '';
    if (result.reasons.includes('RESISTANCE_RAMP_VC')) return 'Unavailable for ramp VC';
    if (result.reasons.includes('RESISTANCE_PRESSURE_CONTROL')) return 'Unavailable for pressure control';
    if (result.reasons.includes('INSPIRATORY_EFFORT')) return 'Effort during inspiration';
    if (result.reasons.includes('NONCONSTANT_INSPIRATORY_FLOW')) return 'Flow not constant';
    return result.status === 'inapplicable' ? 'Measurement unavailable' : '';
}

const MEASUREMENT_HELP_COPY = Object.freeze({
    pplat: 'Available after a completed hold that meets this simulator’s duration, zero-flow, pressure-stability, and effort criteria.',
    'driving-pressure': 'Uses measured Pplat and live modeled total PEEP at breath start.',
    'static-compliance': 'Uses same-breath delivered VT and live modeled total PEEP at breath start.',
    'modeled-baseline': 'Live modeled total PEEP at breath start. Calculated from set PEEP, integrated residual volume, and configured compliance; not measured by an expiratory hold.',
    'inspiratory-resistance': 'Uses same-breath PIP, measured Pplat, and end-inspiratory flow. Available only with passive constant-flow square VC inspiration and a valid completed hold.',
    duration: 'The 0.5–2 s range is this simulator’s measurement criterion.',
});

let openMeasurementHelpTrigger = null;
let measurementHelpClickPinned = false;
let measurementHelpCloseTimer = null;

function detailedResistanceStatusCopy(result) {
    if (result.status === 'valid') return '';
    if (result.reasons.includes('RESISTANCE_RAMP_VC')) return 'Resistance unavailable for ramp VC.';
    if (result.reasons.includes('RESISTANCE_PRESSURE_CONTROL')) return 'Resistance unavailable for pressure control.';
    if (result.reasons.includes('INSPIRATORY_EFFORT')) return 'Resistance unavailable: effort during inspiration.';
    if (result.reasons.includes('NONCONSTANT_INSPIRATORY_FLOW')) return 'Resistance unavailable: inspiratory flow not constant.';
    return detailedHoldStatusCopy(result);
}

function measurementHelpText(key) {
    const base = MEASUREMENT_HELP_COPY[key] ?? 'Measurement unavailable.';
    if (!sim || key === 'modeled-baseline' || key === 'duration') return base;
    const hold = sim.holdMechanics;
    const result = key === 'pplat' ? hold.pplat
        : key === 'driving-pressure' ? hold.drivingPressure
            : key === 'static-compliance' ? hold.compliance
                : hold.resistance;
    if (result.status === 'valid') {
        return key === 'pplat' ? `${base}\n\nValid Pplat measurement.` : base;
    }
    const detail = key === 'inspiratory-resistance'
        ? detailedResistanceStatusCopy(result)
        : detailedHoldStatusCopy(result);
    const reasons = result.reasons.length ? `\nReason codes: ${result.reasons.join(', ')}.` : '';
    return `${base}\n\nCurrent result: ${detail}${reasons}`;
}

function positionMeasurementHelp() {
    const popover = document.getElementById('measurement-help');
    const trigger = openMeasurementHelpTrigger;
    if (!popover || !trigger || popover.hidden) return;
    const triggerBox = trigger.getBoundingClientRect();
    const helpBox = popover.getBoundingClientRect();
    const gap = 6;
    let left = Math.min(triggerBox.left, window.innerWidth - helpBox.width - 8);
    left = Math.max(8, left);
    let top = triggerBox.bottom + gap;
    if (top + helpBox.height > window.innerHeight - 8) top = triggerBox.top - helpBox.height - gap;
    top = Math.max(8, Math.min(top, window.innerHeight - helpBox.height - 8));
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
}

function openMeasurementHelp(trigger, clickPinned = false) {
    const popover = document.getElementById('measurement-help');
    const text = document.getElementById('measurement-help-text');
    if (!popover || !text) return;
    if (openMeasurementHelpTrigger && openMeasurementHelpTrigger !== trigger) {
        openMeasurementHelpTrigger.setAttribute('aria-expanded', 'false');
        openMeasurementHelpTrigger.removeAttribute('aria-describedby');
    }
    clearTimeout(measurementHelpCloseTimer);
    openMeasurementHelpTrigger = trigger;
    measurementHelpClickPinned = clickPinned;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-describedby', 'measurement-help');
    text.textContent = measurementHelpText(trigger.dataset.measurementHelp);
    popover.hidden = false;
    positionMeasurementHelp();
}

function closeMeasurementHelp(restoreFocus = false) {
    const popover = document.getElementById('measurement-help');
    const trigger = openMeasurementHelpTrigger;
    clearTimeout(measurementHelpCloseTimer);
    if (popover) popover.hidden = true;
    if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        trigger.removeAttribute('aria-describedby');
        if (restoreFocus) trigger.focus();
    }
    openMeasurementHelpTrigger = null;
    measurementHelpClickPinned = false;
}

function scheduleMeasurementHelpClose() {
    clearTimeout(measurementHelpCloseTimer);
    measurementHelpCloseTimer = setTimeout(() => {
        const popover = document.getElementById('measurement-help');
        if (!measurementHelpClickPinned && document.activeElement !== openMeasurementHelpTrigger
            && !popover?.matches(':hover')) closeMeasurementHelp();
    }, 160);
}

function refreshOpenMeasurementHelp() {
    if (!openMeasurementHelpTrigger) return;
    if (!openMeasurementHelpTrigger.getClientRects().length) {
        closeMeasurementHelp();
        return;
    }
    const text = document.getElementById('measurement-help-text');
    if (text) text.textContent = measurementHelpText(openMeasurementHelpTrigger.dataset.measurementHelp);
    positionMeasurementHelp();
}

function bindMeasurementHelp() {
    const popover = document.getElementById('measurement-help');
    if (!popover) return;
    for (const trigger of document.querySelectorAll('.measurement-help-trigger')) {
        trigger.setAttribute('aria-controls', 'measurement-help');
        trigger.addEventListener('pointerenter', () => openMeasurementHelp(trigger));
        trigger.addEventListener('pointerleave', scheduleMeasurementHelpClose);
        trigger.addEventListener('focus', () => openMeasurementHelp(trigger));
        trigger.addEventListener('blur', scheduleMeasurementHelpClose);
        trigger.addEventListener('click', () => {
            if (openMeasurementHelpTrigger === trigger && measurementHelpClickPinned) {
                closeMeasurementHelp();
            } else {
                openMeasurementHelp(trigger, true);
            }
        });
    }
    popover.addEventListener('pointerenter', () => clearTimeout(measurementHelpCloseTimer));
    popover.addEventListener('pointerleave', scheduleMeasurementHelpClose);
    document.addEventListener('pointerdown', event => {
        if (openMeasurementHelpTrigger && !popover.contains(event.target)
            && !openMeasurementHelpTrigger.contains(event.target)) closeMeasurementHelp();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && openMeasurementHelpTrigger) {
            event.preventDefault();
            closeMeasurementHelp(true);
        }
    });
    window.addEventListener('resize', positionMeasurementHelp);
    document.addEventListener('scroll', positionMeasurementHelp, true);
}

function updateHoldResults() {
    const panel = document.getElementById('hold-results');
    if (!panel) return;
    const hold = sim.holdMechanics;
    setHoldReasonDescription('param-pplat', hold.pplat);
    setHoldReasonDescription('param-dp', hold.drivingPressure);
    if (!vent.holdActive) {
        panel.style.display = 'none';
        refreshOpenMeasurementHelp();
        return;
    }
    panel.style.display = '';
    setText('hold-status', holdStatusCopy(hold));
    setText('hold-pplat', formatHoldValue(hold.pplat.value));
    setText('hold-dp', formatHoldValue(hold.drivingPressure.value));
    setText('hold-crs', formatHoldValue(hold.compliance.value));
    setText('hold-raw', formatHoldValue(hold.resistance.value));
    setText('hold-raw-status', resistanceStatusCopy(hold.resistance, hold.pplat));
    setHoldReasonDescription('hold-pplat', hold.pplat);
    setHoldReasonDescription('hold-dp', hold.drivingPressure);
    setHoldReasonDescription('hold-crs', hold.compliance);
    setHoldReasonDescription('hold-raw', hold.resistance);
    setHoldReasonDescription('hold-status', { status: hold.status, reasons: hold.reasons });
    refreshOpenMeasurementHelp();
}

function setHoldReasonDescription(id, result) {
    const element = document.getElementById(id);
    if (!element) return;
    const description = result.reasons.length
        ? `${result.status}: ${result.reasons.join(', ')}`
        : result.status;
    element.title = description;
    element.setAttribute('aria-label', `${element.textContent}, ${description}`);
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


// =============================================================================
// TEST DETERMINISM SURFACE
// =============================================================================
/**
 * `window.__vsim` — a small control surface that exists so automated tests can
 * render a *deterministic* frame.
 *
 * A real-time canvas animation can never produce byte-stable screenshots. The
 * number of ticks between two rendered frames depends on frame timing, which
 * depends on the machine, the GPU, headless mode, even AC vs battery. So visual
 * tests do not watch the live loop: they stop it and render one frame at an
 * exact simulated timestamp.
 *
 * `seek()` steps the engine directly rather than through `advance()`, which
 * bypasses both the 300-tick frame cap and the speed multiplier — so the result
 * is a pure function of the seconds requested.
 *
 * The application never calls any of this. Do not build features on it.
 */
function installTestHooks() {
    window.__vsim = {
        /** Stop the rAF loop. Idempotent. */
        pause() {
            if (animFrame !== null) {
                cancelAnimationFrame(animFrame);
                animFrame = null;
            }
            return true;
        },

        /** Restart the rAF loop from the current state. Idempotent. */
        resume() {
            if (animFrame === null) {
                lastFrameTs = performance.now();
                animFrame = requestAnimationFrame(animate);
            }
            return true;
        },

        /**
         * Pause, reset, advance exactly `seconds` of SIMULATED time, render once.
         *
         * @param {number} seconds
         * @returns {{ticks:number, globalTime:number}}
         */
        seek(seconds) {
            this.pause();
            sim.reset();
            const ticks = Math.round(seconds / sim.dt);
            for (let i = 0; i < ticks; i++) sim.tick();
            renderFrame();
            return { ticks, globalTime: sim.globalTime };
        },

        /**
         * Advance `seconds` from the CURRENT state without resetting, render once.
         * Use when a test has already seeked and then changed a setting.
         */
        step(seconds) {
            this.pause();
            const ticks = Math.round(seconds / sim.dt);
            for (let i = 0; i < ticks; i++) sim.tick();
            renderFrame();
            return { ticks, globalTime: sim.globalTime };
        },

        /** Perturb one collected HOLD pressure sample for an invalid-state visual fixture. */
        offsetCurrentHoldPressure(indexFromEnd, deltaCmH2O) {
            this.pause();
            const samples = sim.currentBreath?.holdCollector?.samples;
            const offset = Number(indexFromEnd);
            const delta = Number(deltaCmH2O);
            if (!samples || !Number.isInteger(offset) || offset < 0 || offset >= samples.length || !Number.isFinite(delta)) {
                return false;
            }
            const index = samples.length - 1 - offset;
            const sample = samples[index];
            samples[index] = Object.freeze({ ...sample, paw_cmH2O: sample.paw_cmH2O + delta });
            return true;
        },

        /** Re-render the current state without advancing time. */
        redraw() {
            renderFrame();
            return true;
        },

        /** Compact snapshot for assertions — cheap to serialise, stable to diff. */
        state() {
            const s = sim.breathSummary;
            return {
                globalTime:      +sim.globalTime.toFixed(3),
                phase:           sim.phaseName,
                mode:            vent.mode,
                teachingMode:    document.body.classList.contains('teaching-mode'),
                breathCount:     s.breathCount,
                machineBreaths:  s.machineBreathCount,
                patientBreaths:  s.patientBreathCount,
                pipLatched:      +s.pipLatched.toFixed(2),
                vt_mL:           +s.vt_mL.toFixed(1),
                measuredRR:      +sim.measuredRR.toFixed(1),
                measuredRRRaw:   sim.measuredRR,
                failedTriggers:  sim.getTriggerEvents().filter(e => e.type === 'failed').length,
                // Read-only evidence for provenance tests; no new engine state.
                completed:       sim.lastCompletedBreath,
                holdMechanics:   sim.holdMechanics,
                runningPip:      s.pip,
                pplat:           s.pplat,
                liveTrapped_mL:  sim.volumeAtBreathStart * 1000,
                predicted:       vent.summary(),
                alarmPip:        getCurrentAlarmMetrics(vent.summary()).pipCmH2O,
            };
        },
    };
}

installTestHooks();
