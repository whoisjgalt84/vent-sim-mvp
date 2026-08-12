/** Run the visual suite in the exact Linux image used by CI. */

import { spawn } from 'node:child_process';

const IMAGE = 'mcr.microsoft.com/playwright:v1.62.1-noble';
const args = [
    'run', '--rm',
    '--mount', `type=bind,source=${process.cwd()},target=/work`,
    '--mount', 'type=volume,destination=/work/node_modules',
    '-w', '/work',
    IMAGE,
    'bash', '-lc', 'npm ci && npm run test:visual -- "$@"', 'visual-tests',
    ...process.argv.slice(2),
];

const child = spawn('docker', args, { stdio: 'inherit', windowsHide: true });
child.on('error', (error) => {
    console.error(`Unable to start Docker: ${error.message}`);
    process.exitCode = 1;
});
child.on('close', (code, signal) => {
    if (signal) {
        console.error(`Pinned visual run ended on ${signal}.`);
        process.exitCode = 1;
    } else if (code !== 0) {
        process.exitCode = 1;
    }
});
