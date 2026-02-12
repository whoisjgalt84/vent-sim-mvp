/**
 * ============================================================================
 * main.js — Application Integration Layer
 * ============================================================================
 *
 * Wires together:
 *   - LungModel (the patient)
 *   - Ventilator (the machine — VC-CMV or PC-CMV, square or ramp flow)
 *   - WaveformDisplay (the screen)
 *   - DOM controls (the operator's hands)
 *
 * MODE SWITCHING:
 *   VC-CMV: Operator sets VT → pressure is dependent
 *   PC-CMV: Operator sets Pinsp → flow & volume are dependent
 *
 * FLOW PATTERN (VC only):
 *   Square: constant flow, linear volume ramp
 *   Ramp:   linearly decelerating flow, parabolic volume curve
 *
 * INSPIRATORY HOLD:
 *   Closes both valves at end of inspiration → flow drops to zero →
 *   pressure equilibrates to Pplat. Reveals:
 *     Crs_static = VT / (Pplat - totalPEEP)
 *     R_airway   = (PIP - Pplat) / V̇  (square flow only)
 *
 * ============================================================================
 */

import { LungModel }      from './lung-model.js';
import { Ventilator }      from './ventilator.js';
import { WaveformDisplay } from './waveforms.js';


// =============================================================================
// STATE
// =============================================================================

let lung;
let vent;
let display;
let currentIE = [1, 2];


// =============================================================================
// INITIALIZATION
// =============================================================================

function init() {
    lung = LungModel.fromPreset('normal');
    vent = new Ventilator(lung, {
        mode:                'vc-cmv',
        flowPattern:         'square',
        holdTime:            0,
        tidalVolume:         0.500,
        inspiratoryPressure: 15,
        respiratoryRate:     14,
        ieRatio:             [1, 2],
        peep:                5,
        fio2:                0.40,
    });

    display = new WaveformDisplay({
        pressure: document.getElementById('canvas-pressure'),
        volume:   document.getElementById('canvas-volume'),
        flow:     document.getElementById('canvas-flow'),
    }, 4);

    bindSlider('vt',         onVtChange);
    bindSlider('rr',         onRrChange);
    bindSlider('pinsp',      onPinspChange);
    bindSlider('peep',       onPeepChange);
    bindSlider('fio2',       onFio2Change);
    bindSlider('compliance', onComplianceChange);
    bindSlider('resistance', onResistanceChange);
    bindSlider('hold-duration', onHoldDurationChange);

    bindPresetSelector();
    bindIEButtons();
    bindModeToggle();
    bindFlowPatternToggle();
    bindHoldToggle();

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => update(), 100);
    });

    update();
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
        update();
    });
}

function applyModeUI(mode) {
    const isPC = mode === 'pc-cmv';

    // Header mode label
    updateModeLabel();

    // Toggle VT + Flow Pattern vs Pinsp
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

    // Toggle PC-specific parameter rows
    document.getElementById('pinsp-param-row').style.display = isPC ? '' : 'none';
    document.getElementById('ti-tau-row').style.display      = isPC ? '' : 'none';

    // Update parameter labels
    document.getElementById('vt-param-label').innerHTML = isPC
        ? 'V<sub>T</sub> <span style="font-size:9px;opacity:0.5">(del)</span>'
        : 'V<sub>T</sub>';

    updateFlowLabel();

    document.getElementById('resist-label').innerHTML = isPC
        ? 'ΔP<sub>eff</sub>'
        : 'P<sub>resist</sub>';

    // R_aw row only makes sense for square VC flow during hold
    updateHoldResultsVisibility();
}

/**
 * Update the header mode label with flow pattern and hold tags.
 */
function updateModeLabel() {
    const modeLabel = document.getElementById('mode-label');
    const isPC = vent.mode === 'pc-cmv';

    let tag = 'set-point';
    if (!isPC && vent.flowPattern === 'ramp') tag = 'ramp';

    const holdTag = vent.holdActive
        ? '<span style="color:var(--color-pressure); margin-left:4px; font-size:10px;">⏸ HOLD</span>'
        : '';

    const modeName = isPC ? 'PC-CMV' : 'VC-CMV';
    modeLabel.innerHTML = `${modeName}<span style="font-weight:normal; font-size:11px; opacity:0.5; margin-left:4px;">${tag}</span>${holdTag}`;
}

/**
 * Update the flow parameter label based on current mode and pattern.
 */
function updateFlowLabel() {
    const label = document.getElementById('flow-param-label');
    if (vent.mode === 'pc-cmv') {
        label.innerHTML = 'V̇<sub>peak</sub>';
    } else if (vent.flowPattern === 'ramp') {
        label.innerHTML = 'V̇<sub>peak</sub>';
    } else {
        label.innerHTML = 'V̇<sub>insp</sub>';
    }
}


// =============================================================================
// FLOW PATTERN TOGGLE (VC only)
// =============================================================================

function bindFlowPatternToggle() {
    const group = document.getElementById('flow-pattern-group');
    group.addEventListener('click', (e) => {
        const btn = e.target.closest('.ie-btn');
        if (!btn) return;

        const pattern = btn.dataset.pattern;
        vent.flowPattern = pattern;

        group.querySelectorAll('.ie-btn').forEach(b => b.classList.remove('ie-btn--active'));
        btn.classList.add('ie-btn--active');

        document.getElementById('flow-pattern-display').textContent =
            pattern === 'ramp' ? 'Ramp ╲' : 'Square ▬';

        updateModeLabel();
        updateFlowLabel();
        updateHoldResultsVisibility();
        update();
    });
}


// =============================================================================
// INSPIRATORY HOLD MANEUVER
// =============================================================================

function bindHoldToggle() {
    const btn = document.getElementById('hold-toggle');
    btn.addEventListener('click', () => {
        const wasActive = vent.holdActive;

        if (wasActive) {
            // Deactivate
            vent.holdTime = 0;
            btn.classList.remove('hold-btn--active');
            document.getElementById('hold-icon').textContent = '▶';
            document.getElementById('hold-btn-label').textContent = 'Activate';
            document.getElementById('hold-display').textContent = 'Off';
            document.getElementById('hold-duration-group').style.display = 'none';
            document.getElementById('hold-results').style.display = 'none';
        } else {
            // Activate with current slider value
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
        update();
    });
}

function onHoldDurationChange(slider) {
    const dur = parseInt(slider.value) / 10;  // slider 3-20 → 0.3-2.0s
    vent.holdTime = dur;
    document.getElementById('hold-duration-display').textContent = `${dur.toFixed(1)}s`;
    document.getElementById('hold-display').textContent = `${dur.toFixed(1)}s`;
}

/**
 * Show/hide the R_aw row in hold results.
 * R_aw = (PIP - Pplat) / V̇ is only valid for square VC flow.
 */
function updateHoldResultsVisibility() {
    const rawRow = document.getElementById('hold-raw-row');
    if (rawRow) {
        const showRaw = vent.holdActive && vent.mode !== 'pc-cmv' && vent.flowPattern !== 'ramp';
        rawRow.style.display = showRaw ? '' : 'none';
    }
}


// =============================================================================
// CONTROL BINDINGS
// =============================================================================

function bindSlider(id, callback) {
    const slider = document.getElementById(id);
    if (!slider) return;
    slider.addEventListener('input', () => {
        callback(slider);
        update();
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

        const compSlider = document.getElementById('compliance');
        const resSlider  = document.getElementById('resistance');
        compSlider.value = Math.round(preset.compliance * 1000);
        resSlider.value  = Math.round(preset.resistance);
        document.getElementById('compliance-display').textContent =
            `${Math.round(preset.compliance * 1000)} mL/cmH₂O`;
        document.getElementById('resistance-display').textContent =
            `${Math.round(preset.resistance)} cmH₂O·s/L`;

        update();
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

        update();
    });
}


// =============================================================================
// UPDATE — The main render loop
// =============================================================================

function update() {
    display.render(vent);

    const s = vent.summary();

    // Pressures
    setText('param-pip',     `${s.pressures.pip_cmH2O}`);
    setText('param-pplat',   `${s.pressures.pplat_cmH2O}`);
    setText('param-map',     `${s.pressures.map_cmH2O}`);
    setText('param-dp',      `${s.pressures.drivingPressure}`);
    setText('param-pr',      `${s.pressures.resistivePressure}`);

    if (s.isPC) {
        setText('param-pinsp', `${s.pressures.inspiratoryPressure}`);
    }

    // PEEP
    setText('param-peep-set',   `${s.pressures.peep_cmH2O}`);
    setText('param-auto-peep',  `${s.pressures.autoPeep_cmH2O}`);
    setText('param-total-peep', `${s.pressures.totalPeep_cmH2O}`);

    // Volumes & Flow
    setText('param-vt',   `${s.volumes.tidalVolume_mL}`);
    setText('param-ve',   `${s.volumes.minuteVentilation}`);
    setText('param-flow', `${s.timing.inspFlow_Lpm}`);

    // Timing
    setText('param-ti',     `${s.timing.inspiratoryTime_s}s`);
    setText('param-te',     `${s.timing.expiratoryTime_s}s`);
    setText('param-te-tau', `${s.safety.teOverTau}`);

    if (s.isPC && s.timing.tiOverTau !== null) {
        setText('param-ti-tau', `${s.timing.tiOverTau}`);
    }

    // Mechanics
    setText('param-crs', `${s.mechanics.compliance * 1000}`);
    setText('param-raw', `${s.mechanics.resistance}`);
    setText('param-tau', `${s.mechanics.timeConstant_s}s`);
    setText('param-ers', `${s.mechanics.elastance}`);

    // Mechanics bar
    updateMechanicsBar(s);

    // Alerts
    updateAlerts(s);

    // Hold results panel
    updateHoldResults(s);
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
        const tiOverTau = s.safety.tiOverTau;
        chips += `
        <span class="mechanics-chip" style="color: ${tiOverTau < 1 ? 'var(--color-warning)' : tiOverTau < 3 ? 'var(--color-pressure)' : 'var(--text-primary)'}">
            <span class="mechanics-chip__symbol">Ti/τ</span>
            ${tiOverTau}
        </span>`;
    }

    // Show flow pattern chip in VC mode
    if (s.flowPattern) {
        const patternColor = s.isRamp ? 'var(--color-flow)' : 'var(--text-dim)';
        chips += `
        <span class="mechanics-chip" style="color: ${patternColor}">
            <span class="mechanics-chip__symbol">Flow</span>
            ${s.isRamp ? '╲Ramp' : '▬Sq'}
        </span>`;
    }

    // Hold indicator chip
    if (s.holdActive) {
        chips += `
        <span class="mechanics-chip" style="color: var(--color-pressure)">
            <span class="mechanics-chip__symbol">Hold</span>
            ${s.timing.holdTime_s}s
        </span>`;
    }

    chips += `
        <span class="mechanics-chip" style="color: ${trappedMl > 20 ? 'var(--color-warning)' : 'var(--text-primary)'}">
            <span class="mechanics-chip__symbol">Trap</span>
            ${trappedMl < 0.1 ? '<1' : Math.round(trappedMl)} mL
        </span>`;

    bar.innerHTML = chips;
}

function updateAlerts(summary) {
    const container = document.getElementById('alerts');
    const badges = [];
    const s = summary;

    if (s.safety.pplatAbove30) {
        badges.push(makeBadge('danger', `Pplat ${s.pressures.pplat_cmH2O} > 30`));
    }

    if (s.safety.drivingPressureAbove15) {
        badges.push(makeBadge('warning', `ΔP ${s.pressures.drivingPressure} > 15`));
    }

    if (s.safety.gasTrappingRisk) {
        badges.push(makeBadge('warning', `Te/τ ${s.safety.teOverTau} < 3`));
    }

    if (s.pressures.autoPeep_cmH2O > 2) {
        badges.push(makeBadge('warning', `AutoPEEP ${s.pressures.autoPeep_cmH2O}`));
    }

    if (s.safety.tiTooShort) {
        badges.push(makeBadge('warning', `Ti/τ ${s.safety.tiOverTau} < 1 — short fill`));
    }

    if (badges.length === 0) {
        badges.push(makeBadge('ok', 'No alerts'));
    }

    container.innerHTML = badges.join('');
}

/**
 * Update the hold results panel with derived measurements.
 *
 * THE CLINICAL GOLD:
 *   - Pplat: alveolar pressure at end-inspiration (when flow = 0)
 *   - PIP − Pplat: the resistive component
 *   - Crs = VT / (Pplat − totalPEEP): static compliance
 *   - Raw = (PIP − Pplat) / V̇: airway resistance (square flow only)
 *
 * These are the exact measurements respiratory therapists compute
 * at the bedside during an inspiratory hold maneuver.
 */
function updateHoldResults(summary) {
    const panel = document.getElementById('hold-results');
    if (!panel) return;

    if (!summary.holdActive) {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = '';

    const s = summary;
    const pplat     = s.pressures.pplat_cmH2O;
    const pip       = s.pressures.pip_cmH2O;
    const totalPeep = s.pressures.totalPeep_cmH2O;

    // Pplat
    setText('hold-pplat', pplat.toFixed(1));

    // PIP − Pplat (resistive drop visible on the waveform)
    setText('hold-pip-pplat', (pip - pplat).toFixed(1));

    // Static compliance: Crs = VT / (Pplat − totalPEEP)
    const dp = pplat - totalPeep;
    if (dp > 0.1) {
        const crs = s.volumes.tidalVolume_mL / dp;
        setText('hold-crs', crs.toFixed(1));
    } else {
        setText('hold-crs', '—');
    }

    // Airway resistance (square VC flow only)
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
