/** Disposable fault injection for R-01/R-11; source and accepted baselines stay untouched. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const simulation = fs.readFileSync(path.join(root, 'js/simulation.js'), 'utf8');
const cases = [
    ['per-frame-rounding', 'const steps = Math.min(wholeTicks, 300);', 'const steps = Math.min(Math.round(realDt * this.speed / this.dt), 300);'],
    ['pause-erases-credit', "pause()  { this.cancelManualHold", "pause()  { this._transportCredit_s = 0; this.cancelManualHold"],
    ['speed-rescales-credit', '    setSpeed(multiplier) {', '    setSpeed(multiplier) { this._transportCredit_s *= multiplier / this.speed;'],
    ['cap-retains-debt', 'simTime - wholeTicks * this.dt', 'simTime - steps * this.dt'],
    ['reset-retains-credit', 'this.globalTime        = 0;\n        this._transportCredit_s = 0;', 'this.globalTime        = 0;'],
    ['negative-peak-floored', 'Math.max(this._breathPIP, this.currentPressure)', 'Math.max(0, this._breathPIP, this.currentPressure)'],
    ['positive-only-latch', 'this.lastBreathPIP = this._breathPIP;', 'if (this._breathPIP > 0) this.lastBreathPIP = this._breathPIP;'],
    ['hold-included', '    _computeHold(C, peep, pmus) {', '    _computeHold(C, peep, pmus) { this._breathPIP = 100;'],
    ['hold-source-legacy-peak', 'sources: freezeRecord({ measuredVT_mL, measuredPIP_cmH2O: this._breathPIP,', 'sources: freezeRecord({ measuredVT_mL, measuredPIP_cmH2O: this.measuredPIP,'],
    ['alarm-uses-display-peak', 'pip:          Math.round(this.measuredPIP * 10) / 10,', 'pip:          Math.round(this._breathPIP * 10) / 10,'],
    ['final-inspiration-sample-excluded', 'if (Number.isFinite(this.currentPressure)) {', 'if (Number.isFinite(this.currentPressure) && this.phaseTime < this.vent.inspiratoryTime) {'],
    ['reset-retains-old-pip', 'this.measuredPIP       = 0;\n        this._breathPIP        = null;    // signed INSPIRATION maximum; null means no finite sample\n        this.lastBreathPIP     = null;', 'this.measuredPIP       = 0;\n        this._breathPIP = null;'],
];
const output = path.join(root, 'evidence/mutations'); fs.mkdirSync(output, { recursive: true });
const receipts = [];
for (const [name, before, after] of cases) {
    const count = simulation.split(before).length - 1;
    if (count !== 1) throw new Error(name + ': expected one mutation site, found ' + count);
    const directory = path.join(output, name); fs.mkdirSync(directory, { recursive: true });
    fs.cpSync(path.join(root, 'js'), path.join(directory, 'js'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(directory, 'js/simulation.js'), simulation.replace(before, after));
    const result = spawnSync(process.execPath, ['tests/review-remediation.test.mjs'], {
        cwd: root, env: { ...process.env, VSM_REVIEW_RUNTIME_URL: pathToFileURL(path.join(directory, 'js/')).href },
        encoding: 'utf8', windowsHide: true,
    });
    const text = result.stdout + result.stderr; fs.writeFileSync(path.join(output, name + '.txt'), text);
    const tally = JSON.parse(text.match(/REVIEW_REMEDIATION_TALLY (.+)/)?.[1] ?? 'null');
    const detected = result.status === 1 && tally?.groups === 15 && tally.failed > 0;
    receipts.push({ name, detected, tally }); console.log(JSON.stringify(receipts.at(-1)));
}
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(receipts, null, 2));
if (!receipts.every(x => x.detected)) process.exitCode = 1;
