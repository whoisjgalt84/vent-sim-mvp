/** Run every commissioned engine gate without allowing a reduced tally. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const gates = [
    ['tests/test-engine.js', output => /Passed:\s*300\b/.test(output) && /Failed:\s*0\b/.test(output), 'legacy engine 300/0'],
    ['tests/adaptive-controller.test.mjs', output => /^ADAPTIVE_CONTROLLER_TALLY 22 passed, 0 failed$/m.test(output), 'adaptive controller 22/0'],
    ['tests/adaptive-integration.test.mjs', output => /^ADAPTIVE_INTEGRATION_TALLY 24 passed, 0 failed$/m.test(output), 'adaptive integration 24/0'],
    ['tests/legacy-mode-preservation.test.mjs', output => {
        const matches = [...output.matchAll(/^LEGACY_PRESERVATION_TALLY (.+)$/gm)];
        if (matches.length !== 1) return false;
        const tally = JSON.parse(matches[0][1]);
        return tally.fixtures === 22 && tally.passed === 22 && tally.failed === 0 && tally.ticks === 92500;
    }, 'legacy preservation 22/0; 92500 ticks'],
];
for (const [file, valid, label] of gates) {
    try {
        const child = spawn(process.execPath, [file], { cwd: root, env: process.env,
            stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
        let output = '';
        for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
            output += chunk;
            (stream === child.stdout ? process.stdout : process.stderr).write(chunk);
        });
        const code = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, signal) => signal ? reject(new Error('Interrupted by ' + signal)) : resolve(code));
        });
        if (code !== 0 || !valid(output)) throw new Error('Expected ' + label + '; exit ' + code);
        console.log('Commissioned gate verified: ' + label);
    } catch (error) {
        console.error('Engine verification failed: ' + error.message);
        process.exitCode = 1;
        break;
    }
}
