/** Build the six-image human-review bundle without approving any baseline. */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const IMAGE = 'mcr.microsoft.com/playwright:v1.62.1-noble';
const BASE_COMMIT = '1e6986ed45a82711036388062e3e38bb5f0471cd';
const snapshotDir = join(process.cwd(), 'tests', 'visual', 'waveforms.spec.js-snapshots');
const outputDir = join(process.cwd(), 'scratch', 'visual-baseline-candidates');

const scenarios = [
    {
        file: 'baseline-chromium-linux.png',
        scenario: 'Baseline VC-CMV, passive patient',
        state: 'VC-CMV; default controls; passive patient; rail expanded; seek 14 s; waveforms crop',
    },
    {
        file: 'teaching-full-chromium-linux.png',
        scenario: 'Teaching Mode, passive patient',
        state: 'VC-CMV; default controls; passive patient; Teaching Mode on; seek 14 s; full page',
    },
    {
        file: 'effort-chromium-linux.png',
        scenario: 'Effort/overbreathing VC-CMV',
        state: 'VC-CMV; Pmus on; patient RR 30/min; Pmus 6 cmH2O; neural Ti 1.0 s; seek 14 s; failed triggers > 0; waveforms crop',
    },
    {
        file: 'effort-teaching-full-chromium-linux.png',
        scenario: 'Effort plus Teaching Mode',
        state: 'VC-CMV; Pmus on; patient RR 30/min; Pmus 6 cmH2O; neural Ti 1.0 s; Teaching Mode on; seek 14 s; failed triggers > 0; full page',
    },
    {
        file: 'weak-csv-chromium-linux.png',
        scenario: 'Weak effort in PC-CSV',
        state: 'PC-CSV; Pmus on; patient RR 20/min; Pmus 0.5 cmH2O; neural Ti 1.0 s; flow trigger 5.0 L/min; Teaching Mode on; seek 14 s; failed triggers > 0; waveforms crop',
    },
    {
        file: 'params-teaching-effort-chromium-linux.png',
        scenario: 'Monitored-value panel in Teaching Mode with effort',
        state: 'VC-CMV; Pmus on; patient RR 30/min; Pmus 6 cmH2O; neural Ti 1.0 s; Teaching Mode on; seek 14 s; failed triggers > 0; monitored-values crop',
    },
];

function git(...args) {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const dirty = git('status', '--porcelain', '--untracked-files=all')
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.slice(3).replaceAll('\\', '/').startsWith('tests/visual/waveforms.spec.js-snapshots/'));
if (dirty.length) {
    throw new Error(
        'Refusing to claim HEAD provenance while non-snapshot source changes are present:\n' + dirty.join('\n'),
    );
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const browsers = JSON.parse(await readFile(join(process.cwd(), 'node_modules', 'playwright-core', 'browsers.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
const playwrightVersion = packageJson.devDependencies?.['@playwright/test'];
if (!playwrightVersion || !IMAGE.includes(`:v${playwrightVersion}-`)) {
    throw new Error(`Playwright package ${playwrightVersion} does not match pinned image ${IMAGE}.`);
}
const chromium = browsers.browsers.find((browser) => browser.name === 'chromium');

const images = [];
for (const item of scenarios) {
    const source = join(snapshotDir, item.file);
    const bytes = await readFile(source);
    if (bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${item.file} is not a PNG.`);
    await copyFile(source, join(outputDir, item.file));
    images.push({
        ...item,
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
        sha256: createHash('sha256').update(bytes).digest('hex'),
    });
}

const manifest = {
    ticket: 'VSM-RESET-001',
    approved: false,
    generatedAt: new Date().toISOString(),
    provenance: {
        baseCommit: BASE_COMMIT,
        sourceCommit: git('rev-parse', 'HEAD'),
        sourceTree: git('rev-parse', 'HEAD^{tree}'),
        playwrightVersion,
        chromiumRevision: chromium?.revision ?? null,
        chromiumBrowserVersion: chromium?.browserVersion ?? null,
        osImage: IMAGE,
    },
    images,
};

await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const markdown = [
    '# VSM-RESET-001 visual baseline candidates',
    '',
    '> Candidate set only. No image in this bundle is approved until Christian explicitly accepts it.',
    '',
    `- Base commit: \`${manifest.provenance.baseCommit}\``,
    `- Source commit: \`${manifest.provenance.sourceCommit}\``,
    `- Source tree: \`${manifest.provenance.sourceTree}\``,
    `- Playwright: \`${manifest.provenance.playwrightVersion}\``,
    `- Chromium revision: \`${manifest.provenance.chromiumRevision}\``,
    `- Browser version: \`${manifest.provenance.chromiumBrowserVersion}\``,
    `- Image: \`${manifest.provenance.osImage}\``,
    '',
    '| Scenario | Filename | Size | SHA-256 | Exact state |',
    '| --- | --- | ---: | --- | --- |',
    ...images.map((image) => `| ${image.scenario} | \`${basename(image.file)}\` | ${image.width}x${image.height} | \`${image.sha256}\` | ${image.state} |`),
    '',
];
await writeFile(join(outputDir, 'manifest.md'), `${markdown.join('\n')}\n`);

console.log(`Review bundle written to ${outputDir}`);
for (const image of images) console.log(`${image.sha256}  ${image.file}`);
