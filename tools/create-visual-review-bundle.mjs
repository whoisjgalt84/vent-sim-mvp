/** Package all suite snapshots for review; never approve or replace baselines.
 * Default: pinned Linux candidates. Windows requires --diagnostic-windows.
 * Options: --snapshot-dir PATH --output-dir PATH (under cwd/scratch)
 *          --scenario-map PATH (supplementary capture-state JSON ledger).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const IMAGE = 'mcr.microsoft.com/playwright:v1.62.1-noble';
const BASE_COMMIT = 'f7ebb4cc7318e86f6a1ecce44bd3fac1e645baec';
const cwd = process.cwd();
const options = {};
for (let i = 2; i < process.argv.length; i++) {
    const argument = process.argv[i];
    if (argument === '--help') {
        console.log('node tools/create-visual-review-bundle.mjs [--diagnostic-windows] [--snapshot-dir PATH] [--output-dir PATH] [--scenario-map PATH]');
        process.exit(0);
    }
    if (argument === '--diagnostic-windows') options.diagnosticWindows = true;
    else if (['--snapshot-dir', '--output-dir', '--scenario-map'].includes(argument)) {
        const value = process.argv[++i];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
        if (options[argument]) throw new Error(`Duplicate ${argument}`);
        options[argument] = value;
    } else throw new Error(`Unknown option ${argument}`);
}
const diagnostic = options.diagnosticWindows === true;
if (process.platform !== (diagnostic ? 'win32' : 'linux')) {
    throw new Error('Default bundles require Linux. Actual Windows diagnostics require --diagnostic-windows; they are not acceptance candidates.');
}
const snapshotDir = resolve(options['--snapshot-dir'] ?? join(cwd, 'tests/visual/waveforms.spec.js-snapshots'));
const outputDir = resolve(options['--output-dir'] ?? join(cwd, 'scratch', diagnostic ? 'visual-windows-diagnostics' : 'visual-baseline-candidates'));
const scratchDir = resolve(cwd, 'scratch');
const inside = (parent, child) => {
    const path = relative(parent, child);
    return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path);
};
if (!inside(scratchDir, outputDir)) throw new Error('Output must be a child directory under cwd/scratch.');
if (outputDir === snapshotDir || inside(outputDir, snapshotDir) || inside(snapshotDir, outputDir)) throw new Error('Snapshot and output directories must be separate.');
// Reject reparse/symlink parents rather than writing outside the declared tree.
for (let path = outputDir; relative(cwd, path) !== ''; path = dirname(path)) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`Symlink output path: ${path}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
}
try {
    if ((await readdir(outputDir)).length) throw new Error(`Output is not empty; nothing was deleted: ${outputDir}`);
} catch (error) { if (error.code !== 'ENOENT') throw error; }

const slash = path => path.replaceAll('\\', '/');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function git(...args) { return execFileSync(process.platform === 'win32' ? 'git.exe' : 'git', args, { cwd, encoding: 'utf8' }); }
const packageJson = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
const installed = JSON.parse(await readFile(join(cwd, 'node_modules/@playwright/test/package.json'), 'utf8'));
const browsers = JSON.parse(await readFile(join(cwd, 'node_modules/playwright-core/browsers.json'), 'utf8'));
const playwrightVersion = packageJson.devDependencies?.['@playwright/test'];
if (installed.version !== playwrightVersion || !IMAGE.includes(`:v${playwrightVersion}-`)) throw new Error(`Declared/installed Playwright must exactly match ${IMAGE}.`);
let dockerMetadata = null;
if (!diagnostic) {
    dockerMetadata = JSON.parse(await readFile('/ms-playwright/.docker-info', 'utf8'));
    if (dockerMetadata.dockerImageName !== IMAGE || dockerMetadata.driverVersion !== playwrightVersion) throw new Error('Linux image metadata does not match pinned Playwright image/version.');
}
const chromium = browsers.browsers.find(browser => browser.name === 'chromium');
const specPath = 'tests/visual/waveforms.spec.js';
const helperPath = 'tests/visual/helpers.js';
const specBytes = await readFile(join(cwd, specPath));
const helperBytes = await readFile(join(cwd, helperPath));
const specLines = specBytes.toString('utf8').split(/\r?\n/);
const specHash = sha256(specBytes);
const supplementaryPath = resolve(options['--scenario-map'] ?? join(cwd, 'scratch/shots-vsm-adapt-001-phase-b/visual-scenarios.json'));
let supplementaryBytes = null;
try { supplementaryBytes = await readFile(supplementaryPath); }
catch (error) { if (error.code !== 'ENOENT' || options['--scenario-map']) throw error; }
const supplementary = supplementaryBytes ? JSON.parse(supplementaryBytes.toString('utf8')) : null;

// HEAD is a reference checkpoint, not the identity of uncommitted source bytes.
// Snapshot images have a separate ledger; ignored scratch evidence is excluded.
async function captureSources() {
    const names = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))]
        .filter(path => !/tests\/visual\/[^/]+-snapshots\//.test(slash(path)))
        .filter(path => resolve(cwd, path) !== outputDir && !inside(outputDir, resolve(cwd, path))).sort();
    const entries = [];
    for (const path of names) {
        try {
            if (!(await lstat(join(cwd, path))).isFile()) throw new Error(`Source is not a regular file: ${path}`);
            const bytes = await readFile(join(cwd, path));
            entries.push({ path: slash(path), bytes: bytes.length, sha256: sha256(bytes) });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            entries.push({ path: slash(path), missing: true });
        }
    }
    return entries;
}
const sources = await captureSources();
const sourceManifestHash = sha256(JSON.stringify(sources));
const sourceHashes = new Map(sources.map(item => [item.path, item.sha256]));
if (sourceHashes.get(specPath) !== specHash || sourceHashes.get(helperPath) !== sha256(helperBytes)) throw new Error('Recipe source changed before source capture.');
const sourceStatus = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0').filter(Boolean);
const headCommit = git('rev-parse', 'HEAD').trim();
const headTree = git('rev-parse', 'HEAD^{tree}').trim();
const originalDescriptions = {
    baseline: 'Baseline VC-CMV, passive patient; rail expanded; seek 14 s; waveforms crop.',
    'teaching-full': 'VC-CMV, passive patient; Teaching Mode; seek 14 s; full page.',
    effort: 'VC-CMV; patient RR30/min, Pmus6 cmH2O, neural Ti1 s; seek14 s; failed triggers; waveforms crop.',
    'effort-teaching-full': 'VC-CMV effort RR30/min, Pmus6, neural Ti1 s; Teaching Mode; seek14 s; full page.',
    'weak-csv': 'PC-CSV; patient RR20/min, Pmus0.5, neural Ti1 s, flow trigger5 L/min; Teaching Mode; seek14 s; waveforms crop.',
    'params-teaching-effort': 'VC-CMV effort RR30/min, Pmus6, neural Ti1 s; Teaching Mode; seek14 s; monitored-values crop.',
};
function recipeFor(id) {
    let index = specLines.findIndex(line => (line.includes(`'${id}.png'`) || line.includes(`"${id}.png"`))
        && !/^\s*['"][^'"]+\.png['"]\s*:/.test(line));
    let locator = 'Literal screenshot call; execute its containing test from its beginning, including preceding state changes.';
    if (index < 0 && id.startsWith('pc-disclosure-')) {
        index = specLines.findIndex(line => line.includes('async function pcDisclosureSnapshots('));
        locator = 'pcDisclosureSnapshots(page): mode/effort/layout/viewport loop; filename encodes selected branch.';
    } else if (index < 0 && /^examples-.+-(selected|help)$/.test(id)) {
        index = specLines.findIndex(line => line.includes('async function mechanicsExampleSnapshots('));
        locator = 'mechanicsExampleSnapshots(page): preset selection/help loop; Playwright normalizes preset underscores to filename hyphens.';
    }
    if (index < 0) throw new Error(`No source recipe for ${id}; add its recipe before packaging this image.`);
    const enclosing = specLines.slice(0, index + 1).reverse().find(line => /^\s*test\('/.test(line));
    return {
        screenshotId: `${id}.png`, source: specPath, sourceSha256: specHash,
        sourceLine: index + 1, sourceText: specLines[index].trim(), test: enclosing?.trim() ?? null, locator,
        description: originalDescriptions[id] ?? `Suite screenshot ${id}; the hashed source recipe specifies setup, preceding changes, and capture.`,
        captureState: supplementary?.candidates?.[`${id}.png`] ?? null,
    };
}
const suffix = `-chromium-${process.platform}.png`;
const files = (await readdir(snapshotDir, { withFileTypes: true })).filter(entry => entry.name.endsWith(suffix)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
if (!files.length) throw new Error(`No ${suffix} suite snapshots in ${snapshotDir}.`);
const captured = [];
for (const entry of files) {
    if (!entry.isFile()) throw new Error(`Snapshot is not a regular file: ${entry.name}`);
    const bytes = await readFile(join(snapshotDir, entry.name));
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`Invalid PNG: ${entry.name}`);
    const recipe = recipeFor(entry.name.slice(0, -suffix.length));
    if (supplementary && entry.name.startsWith('adaptive-') && !recipe.captureState) throw new Error(`Missing adaptive capture state: ${entry.name}`);
    if (recipe.captureState) {
        const capture = recipe.captureState;
        if (capture.platform !== process.platform || resolve(capture.snapshotPath) !== resolve(snapshotDir, entry.name)) throw new Error(`Capture platform/path mismatch: ${entry.name}`);
        if (!capture.recipe || !capture.sourceSha256?.[specPath]) throw new Error(`Capture recipe/source identity missing: ${entry.name}`);
        for (const [path, hash] of Object.entries(capture.sourceSha256)) {
            if (sourceHashes.get(path) !== hash) throw new Error(`Capture source mismatch for ${entry.name}: ${path}`);
        }
        recipe.description = capture.recipe;
        recipe.captureSourceHashesVerified = true;
    }
    captured.push({ bytes, image: {
        file: entry.name, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length,
        sha256: sha256(bytes), recipe,
    } });
}
if (sha256(JSON.stringify(await captureSources())) !== sourceManifestHash) throw new Error('Source changed during capture; no bundle written.');
if (supplementaryBytes && sha256(await readFile(supplementaryPath)) !== sha256(supplementaryBytes)) throw new Error('Scenario map changed during capture; no bundle written.');
const images = captured.map(item => item.image);
const label = diagnostic ? 'Windows diagnostics — NOT Linux, NOT acceptance candidates' : 'Pinned Linux visual candidates — owner acceptance required';
const manifest = {
    ticket: 'VSM-ADAPT-001', schemaVersion: 2, approved: false, acceptanceCandidate: !diagnostic,
    classification: diagnostic ? 'windows-diagnostic-only' : 'unapproved-pinned-linux-candidate', label,
    generatedAt: new Date().toISOString(), imageCount: images.length,
    provenance: {
        baseCheckpoint: BASE_COMMIT, headCommitReference: headCommit, headTreeReference: headTree,
        sourceIdentity: 'Exact working-tree file bytes in source-manifest.json; HEAD is a reference only.',
        sourceManifestSha256: sourceManifestHash, sourceStatus,
        sourceScope: 'Tracked and nonignored untracked files, excluding suite snapshot directories and this output. Ignored scratch evidence is not source identity.',
        runtimePlatform: process.platform, architecture: process.arch, nodeVersion: process.version,
        playwrightVersion, chromiumRevision: chromium?.revision ?? null, chromiumBrowserVersion: chromium?.browserVersion ?? null,
        browserMetadataLimitation: 'Installed Playwright metadata; this packager does not launch a browser or prove the capture browser.',
        pinnedImage: diagnostic ? null : IMAGE, dockerMetadata, snapshotDirectory: slash(relative(cwd, snapshotDir)),
        captureLimitation: 'Packages existing suite snapshot bytes. Separate run logs establish capture generation, test results, and source-at-capture identity. Packaging does not run or pass a Linux comparison.',
        supplementaryScenarioMap: supplementaryBytes ? { file: 'recipes/visual-scenarios.json', originalName: basename(supplementaryPath), sha256: sha256(supplementaryBytes) } : null,
    }, images,
};
await mkdir(outputDir, { recursive: true });
if (!inside(await realpath(scratchDir), await realpath(outputDir))) throw new Error('Resolved output escaped scratch.');
if ((await readdir(outputDir)).length) throw new Error('Output became nonempty during capture; refusing overwrite.');
const put = (path, content) => writeFile(join(outputDir, path), content, { flag: 'wx' });
await mkdir(join(outputDir, 'recipes'));
await put('recipes/waveforms.spec.js', specBytes);
await put('recipes/helpers.js', helperBytes);
if (supplementaryBytes) await put('recipes/visual-scenarios.json', supplementaryBytes);
for (const item of captured) await put(item.image.file, item.bytes);
await put('source-manifest.json', `${JSON.stringify({ hashAlgorithm: 'SHA-256', canonicalEntriesSha256: sourceManifestHash, files: sources }, null, 2)}\n`);
await put('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
const html = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
await put('index.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${html(label)}</title>
<style>body{font:16px system-ui;margin:24px;background:#f4f6f8;color:#132235}h1{font-size:26px}aside{padding:16px;background:#fff1ce;border:2px solid #9e6500}article{margin:28px 0;padding:18px;background:white;border:1px solid #aaa}code{overflow-wrap:anywhere}.image{overflow:auto;border:1px solid #aaa}img{display:block;max-width:none}a{color:#064b9e}nav{columns:3;column-width:260px}</style>
<h1>VSM-ADAPT-001: ${html(label)}</h1><aside>No image is approved. ${diagnostic ? 'These Windows diagnostics are not eligible for Linux baseline acceptance and do not establish a Linux comparison.' : 'Separate test logs and explicit owner image acceptance are required.'} Original PNG bytes appear at full pixel dimensions; scroll each image horizontally as needed.</aside>
<p>${images.length} images. Base checkpoint <code>${BASE_COMMIT}</code>. Working-tree identity <code>${sourceManifestHash}</code>.</p>
<p><a href="manifest.json">Image manifest</a> · <a href="source-manifest.json">Working-tree source hashes</a> · <a href="recipes/waveforms.spec.js">Exact screenshot recipes</a> · <a href="recipes/helpers.js">Recipe helpers</a></p>
<nav>${images.map((item, index) => `<div><a href="#image-${index}">${html(item.file)}</a></div>`).join('')}</nav>
${images.map((item, index) => `<article id="image-${index}"><h2>${html(item.file)}</h2><p>${html(item.recipe.description)}</p><p>${item.width} × ${item.height} px · SHA-256 <code>${item.sha256}</code></p><p>Recipe: ${html(item.recipe.source)}:${item.recipe.sourceLine}; SHA-256 <code>${item.recipe.sourceSha256}</code>. ${html(item.recipe.locator)}</p><p><a href="${encodeURIComponent(item.file)}">Open original PNG</a></p><div class="image"><img src="${encodeURIComponent(item.file)}" width="${item.width}" height="${item.height}" alt="${html(item.recipe.screenshotId)}" loading="lazy"></div></article>`).join('\n')}</html>\n`);
await put('manifest.md', `# VSM-ADAPT-001: ${label}\n\nNo images are approved. ${manifest.provenance.captureLimitation}\n\nBase checkpoint: \`${BASE_COMMIT}\`\n\nWorking-tree identity: \`${sourceManifestHash}\` (HEAD is a reference only).\n\nRuntime: ${process.platform}; Playwright ${playwrightVersion}; pinned image: ${manifest.provenance.pinnedImage ?? 'none — Windows diagnostic'}.\n\nOpen [the full-resolution gallery](index.html).\n\n| Screenshot | Pixels | SHA-256 | Recipe source line |\n| --- | ---: | --- | --- |\n${images.map(item => `| ${item.file} | ${item.width}×${item.height} | ${item.sha256} | ${specPath}:${item.recipe.sourceLine} |`).join('\n')}\n`);
console.log(`${label}\n${images.length} images packaged at ${outputDir}\nWorking-tree SHA-256: ${sourceManifestHash}\nNo baseline files were written.`);
