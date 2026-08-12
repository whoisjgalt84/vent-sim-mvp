/**
 * Self-contained supervisor for the 44-check real-browser verification.
 *
 * Reuses a healthy Vent-Sim server on port 8899. Otherwise it starts the
 * repository's Node server, waits for a bounded health check, runs the existing
 * assertion harness, and terminates only the server process it owns.
 */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const serverFile = fileURLToPath(new URL('./serve.mjs', import.meta.url));
const harnessFile = fileURLToPath(new URL('../scratch/verify-batch.cjs', import.meta.url));
const playwrightCli = fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url));
const healthUrl = new URL('http://127.0.0.1:8899/index.html');
const START_TIMEOUT_MS = 15_000;
const visualMode = process.argv[2] === '--visual';
const updatingSnapshots = process.argv.slice(3).includes('--update-snapshots');
const require = createRequire(import.meta.url);

let ownedServer = null;
let testProcess = null;
let stopping = false;
let serverStopPromise = null;

async function exists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function runChild(args, env = process.env) {
    const child = spawn(process.execPath, args, {
        cwd: root,
        env,
        stdio: 'inherit',
        windowsHide: true,
    });
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {
            if (signal) reject(new Error(`Process ended on ${signal}.`));
            else resolve(code ?? 1);
        });
    });
}

function stripAnsi(value) {
    return value.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '');
}

function requireCommissionedTally(output) {
    const cleanOutput = stripAnsi(output);
    const pattern = visualMode
        ? /^COMMISSIONED_VISUAL_TALLY (\d+) passed, (\d+) failed$/gm
        : /^\s*(\d+) passed, (\d+) failed\s*$/gm;
    const matches = [...cleanOutput.matchAll(pattern)];
    const expectedPassed = visualMode ? 9 : 44;
    const label = visualMode ? 'visual/determinism' : 'browser';

    if (matches.length !== 1) {
        throw new Error(
            `Commissioned ${label} tally output is missing or malformed; expected exactly one ` +
            `"${expectedPassed} passed, 0 failed" tally but found ${matches.length}.`,
        );
    }

    const passed = Number(matches[0][1]);
    const failed = Number(matches[0][2]);
    if (passed !== expectedPassed || failed !== 0) {
        throw new Error(
            `Commissioned ${label} tally is ${expectedPassed} passed / 0 failed; ` +
            `received ${passed} passed / ${failed} failed.`,
        );
    }

    console.log(`Commissioned ${label} tally verified: ${passed} passed, ${failed} failed.`);
}

async function ensureManagedChromium() {
    if (process.env.CHROMIUM_PATH) return;
    const executable = require('playwright').chromium.executablePath();
    if (await exists(executable)) return;

    console.log('Playwright Chromium is not installed; installing the pinned managed browser ...');
    const code = await runChild([playwrightCli, 'install', 'chromium']);
    if (code !== 0 || !(await exists(executable))) {
        throw new Error(
            `Playwright Chromium installation failed (exit ${code}). ` +
            'Retry with: npx playwright install chromium',
        );
    }
}

async function requireVisualBaselines() {
    if (!visualMode || updatingSnapshots) return;
    const suffix = `chromium-${process.platform}.png`;
    const names = [
        'baseline',
        'teaching-full',
        'effort',
        'effort-teaching-full',
        'weak-csv',
        'params-teaching-effort',
    ];
    const dir = join(root, 'tests', 'visual', 'waveforms.spec.js-snapshots');
    const missing = [];
    for (const name of names) {
        const file = `${name}-${suffix}`;
        if (!(await exists(join(dir, file)))) missing.push(file);
    }
    if (missing.length) {
        throw new Error(
            'Visual comparison requires all six reviewed snapshots and will not create missing truth. ' +
            `Missing: ${missing.join(', ')}`,
        );
    }
}

function probeServer() {
    return new Promise((resolve) => {
        const req = request(healthUrl, { method: 'GET', timeout: 1_000 }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                if (body.length < 64_000) body += chunk;
            });
            res.on('end', () => resolve({
                healthy: res.statusCode === 200 && /<title>Ventilator Simulator\b/.test(body),
                detail: `HTTP ${res.statusCode}`,
            }));
        });
        req.on('timeout', () => req.destroy(new Error('request timed out')));
        req.on('error', (error) => resolve({ healthy: false, detail: error.message }));
        req.end();
    });
}

async function stopOwnedServer() {
    if (serverStopPromise) return serverStopPromise;
    const server = ownedServer;
    if (!server) return;

    serverStopPromise = (async () => {
        if (server.exitCode === null && server.signalCode === null) {
            server.kill('SIGTERM');
            await Promise.race([
                new Promise((resolve) => server.once('close', resolve)),
                delay(5_000),
            ]);
        }
        if (server.exitCode === null && server.signalCode === null) {
            if (!server.kill('SIGKILL')) throw new Error('Unable to force-stop the owned Vent-Sim server.');
            await Promise.race([
                new Promise((resolve) => server.once('close', resolve)),
                delay(1_000),
            ]);
        }
        if (server.exitCode === null && server.signalCode === null) {
            throw new Error(`Owned Vent-Sim server PID ${server.pid} did not terminate.`);
        }
        ownedServer = null;
    })();

    try {
        await serverStopPromise;
    } finally {
        serverStopPromise = null;
    }
}

async function handleSignal(signal) {
    if (stopping) return;
    stopping = true;
    console.error(`Browser verification interrupted by ${signal}; cleaning up.`);
    if (testProcess && testProcess.exitCode === null && testProcess.signalCode === null) {
        testProcess.kill(signal);
    }
    await stopOwnedServer();
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => void handleSignal(signal));
}

async function ensureServer() {
    const existing = await probeServer();
    if (existing.healthy) {
        console.log(`Reusing healthy Vent-Sim server at ${healthUrl.href}`);
        return;
    }

    console.log(`Starting Vent-Sim server at ${healthUrl.origin} ...`);
    ownedServer = spawn(process.execPath, [serverFile, '8899'], {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    ownedServer.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
    ownedServer.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

    const deadline = Date.now() + START_TIMEOUT_MS;
    let lastDetail = existing.detail;
    while (Date.now() < deadline) {
        if (ownedServer.exitCode !== null || ownedServer.signalCode !== null) break;
        const probe = await probeServer();
        if (probe.healthy) {
            console.log('Vent-Sim server is healthy.');
            return;
        }
        lastDetail = probe.detail;
        await delay(100);
    }

    throw new Error(
        `Vent-Sim server did not become healthy within ${START_TIMEOUT_MS / 1000}s (${lastDetail}). ` +
        'Port 8899 may be occupied by another service.',
    );
}

async function runHarness() {
    const target = visualMode
        ? [playwrightCli, 'test', ...process.argv.slice(3)]
        : [harnessFile];
    testProcess = spawn(process.execPath, target, {
        cwd: root,
        env: process.env,
        stdio: ['inherit', 'pipe', 'pipe'],
        windowsHide: true,
    });

    let output = '';
    for (const stream of [testProcess.stdout, testProcess.stderr]) {
        stream.on('data', (chunk) => {
            output += chunk;
            (stream === testProcess.stdout ? process.stdout : process.stderr).write(chunk);
        });
    }

    return new Promise((resolve, reject) => {
        testProcess.once('error', reject);
        testProcess.once('close', (code, signal) => {
            if (signal) reject(new Error(`Browser assertion process ended on ${signal}.`));
            else resolve({ code: code ?? 1, output });
        });
    });
}

try {
    await requireVisualBaselines();
    await ensureManagedChromium();
    await ensureServer();
    const { code, output } = await runHarness();
    requireCommissionedTally(output);
    if (code !== 0) process.exitCode = code;
} catch (error) {
    console.error(`${visualMode ? 'Visual' : 'Browser'} verification could not run: ${error.message}`);
    process.exitCode = 1;
} finally {
    await stopOwnedServer();
}
