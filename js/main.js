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

    bindPresetSelector();
    bindIEButtons();
    bindModeToggle();
    bindFlowPatternToggle();

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
    const modeLabel = document.getElementById('mode-label');
    if (isPC) {
        modeLabel.innerHTML = 'PC-CMV<span style="font-weight:normal; font-size:11px; opacity:0.5; margin-left:4px;">set-point</span>';
    } else {
        const patternTag = vent.flowPattern === 'ramp' ? 'ramp' : 'set-point';
        modeLabel.innerHTML = `VC-CMV<span style="font-weight:normal; font-size:11px; opacity:0.5; margin-left:4px;">${patternTag}</span>`;
    }

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

    // Flow label: peak for ramp and PC, constant for square
    updateFlowLabel();

    document.getElementById('resist-label').innerHTML = isPC
        ? 'ΔP<sub>eff</sub>'
        : 'P<sub>resist</sub>';
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

        // Update header tag and flow label
        const modeLabel = document.getElementById('mode-label');
        const tag = pattern === 'ramp' ? 'ramp' : 'set-point';
        modeLabel.innerHTML = `VC-CMV<span style="font-weight:normal; font-size:11px; opacity:0.5; margin-left:4px;">${tag}</span>`;

        updateFlowLabel();
        update();
    });
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

function makeBadge(level, text) {
    return `<span class="alert-badge alert-badge--${level}">${text}</span>`;
}


// =============================================================================
// START
// =============================================================================

document.addEventListener('DOMContentLoaded', init);
