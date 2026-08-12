/**
 * Run the engine assertions and enforce the commissioned 300/0 tally.
 *
 * tests/test-engine.js already exits nonzero on assertion failure. This wrapper
 * also prevents a silently reduced assertion count from passing CI.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testFile = fileURLToPath(new URL('../tests/test-engine.js', import.meta.url));
const child = spawn(process.execPath, [testFile], {
    cwd: root,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
});

let output = '';
for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
        output += chunk;
        (stream === child.stdout ? process.stdout : process.stderr).write(chunk);
    });
}

child.on('error', (error) => {
    console.error(`Unable to start the engine test process: ${error.message}`);
    process.exitCode = 1;
});

child.on('close', (code, signal) => {
    if (signal) {
        console.error(`Engine tests were interrupted by ${signal}.`);
        process.exitCode = 1;
        return;
    }
    if (code !== 0) {
        process.exitCode = code || 1;
        return;
    }

    const passed = Number(output.match(/Passed:\s*(\d+)/)?.[1]);
    const failed = Number(output.match(/Failed:\s*(\d+)/)?.[1]);
    if (passed !== 300 || failed !== 0) {
        console.error(`Commissioned engine tally is 300 passed / 0 failed; received ${passed} passed / ${failed} failed.`);
        process.exitCode = 1;
    }
});
