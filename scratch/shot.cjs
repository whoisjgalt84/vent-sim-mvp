/**
 * Headless screenshot harness for the vent simulator.
 *
 *   node scratch/shot.cjs <outDir> <scenario> [scenario...]
 *
 * Scenarios are named recipes below. Each produces <outDir>/<name>.png
 * (full page) and, where useful, cropped element shots.
 *
 * Requires a static server on :8899 — `npm run serve` (node tools/serve.mjs).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_BASE = 'http://127.0.0.1:8899/index.html';

const outDir = process.argv[2] || 'scratch/shots';
const want = process.argv.slice(3);

fs.mkdirSync(outDir, { recursive: true });

/** Expand every collapsed control group in the left rail. */
async function expandRail(page) {
    await page.$$eval('.controls [data-collapsible][data-collapsed]', (els) => {
        els.forEach((el) => el.click());
    });
    await page.waitForTimeout(150);
}

/** Drive the effort controls into an overbreathing state. */
async function enableEffort(page, { patientRR = 30, pmus = 6, neuralTi = 10 } = {}) {
    await expandRail(page);
    await page.click('#pmus-toggle');
    await page.$eval('#pmus-max', (el, v) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, pmus);
    await page.$eval('#neural-ti', (el, v) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, neuralTi);
    await page.$eval('#patient-rr', (el, v) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, patientRR);
}

async function setMode(page, mode) {
    await page.click(`.mode-btn[data-mode="${mode}"]`);
}

const SCENARIOS = {
    /** Default landing state, passive patient, VC-CMV. */
    baseline: async (page) => { await expandRail(page); await page.waitForTimeout(9000); },

    /** Teaching Mode, passive. */
    teaching: async (page) => {
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(9000);
    },

    /** Overbreathing patient in VC-CMV — the phase-gate ineffective-effort case. */
    effort: async (page) => {
        await enableEffort(page, { patientRR: 30, pmus: 6 });
        await page.waitForTimeout(14000);
    },

    /** Same, in Teaching Mode — where the counter + labels live. */
    'effort-teaching': async (page) => {
        await enableEffort(page, { patientRR: 30, pmus: 6 });
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(14000);
    },

    /** Weak effort in PC-CSV — the sub-threshold (SME-021) failure morphology. */
    'weak-csv': async (page) => {
        await setMode(page, 'PC-CSV');
        await enableEffort(page, { patientRR: 20, pmus: 2 });
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(14000);
    },

    /** Loops on while Teaching Mode is on (SME-012). */
    'teaching-loops': async (page) => {
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(500);
        const on = await page.$eval('#btn-loops', (b) => b.classList.contains('transport-btn--active'));
        if (!on) await page.click('#btn-loops');
        await page.waitForTimeout(9000);
    },

    /** Trip the high-pressure alarm, then silence it (SME-018). */
    'alarm-silenced': async (page) => {
        await expandRail(page);
        await page.$eval('#compliance', (el) => {
            el.value = String(el.min);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForTimeout(8000);
        const btn = await page.$('#alarm-silence-btn');
        const disabled = await btn.isDisabled();
        if (!disabled) await btn.click();
        await page.waitForTimeout(2500);
    },
};

(async () => {
    const launchOptions = { args: ['--no-sandbox'] };
    if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
    const browser = await chromium.launch(launchOptions);
    const names = want.length ? want : Object.keys(SCENARIOS);

    for (const name of names) {
        const recipe = SCENARIOS[name];
        if (!recipe) { console.log(`!! unknown scenario ${name}`); continue; }

        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

        await page.goto(`${URL_BASE}?cachebust=${name}`, { waitUntil: 'networkidle' });
        await recipe(page);

        await page.screenshot({ path: path.join(outDir, `${name}.png`) });

        // Right-hand monitor column, cropped — where the readouts live.
        const params = await page.$('.parameters');
        if (params) await params.screenshot({ path: path.join(outDir, `${name}--params.png`) });

        // Left rail, cropped — where the effort sliders live (hidden in teaching mode).
        const controls = await page.$('.controls');
        if (controls) {
            const box = await controls.boundingBox();
            if (box && box.width > 4) {
                await controls.screenshot({ path: path.join(outDir, `${name}--rail.png`) });
            }
        }

        // Patient-effort control, cropped (SME-002 units + fit).
        const effort = await page.$('#pmus-sliders');
        if (effort) {
            const b = await effort.boundingBox();
            if (b && b.width > 4) {
                await effort.screenshot({ path: path.join(outDir, `${name}--effort.png`) });
            }
        }

        const overflow = await page.evaluate(() => {
            const rail = document.querySelector('.controls');
            if (!rail) return null;
            const rb = rail.getBoundingClientRect();
            const spills = [];
            rail.querySelectorAll('*').forEach((el) => {
                const b = el.getBoundingClientRect();
                if (b.width === 0) return;
                if (b.right > rb.right + 0.5 || b.left < rb.left - 0.5) {
                    spills.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${el.className}`
                        + ` L${b.left.toFixed(0)}/R${b.right.toFixed(0)} vs rail L${rb.left.toFixed(0)}/R${rb.right.toFixed(0)}`);
                }
            });
            const panel = document.querySelector('.parameters');
            const clipped = [];
            if (panel) {
                const pb = panel.getBoundingClientRect();
                panel.querySelectorAll('.param-row__value, .rr-triple__num, .rr-triple__lbl, .param-mode__value, .param-row__label')
                    .forEach((el) => {
                        const b = el.getBoundingClientRect();
                        if (b.width === 0) return;
                        if (b.right > pb.right - 1 || b.left < pb.left + 1) {
                            clipped.push(`${el.className}|${el.textContent.trim().slice(0, 14)}`
                                + ` R${b.right.toFixed(0)} vs panel R${pb.right.toFixed(0)}`);
                        }
                    });
            }
            return { railWidth: rb.width, scrollW: rail.scrollWidth, clientW: rail.clientWidth, spills, clipped };
        });

        console.log(`\n== ${name} ==`);
        if (overflow) console.log('  rail:', JSON.stringify(overflow));
        if (errors.length) console.log('  PAGE ERRORS:', errors.slice(0, 6));
        await ctx.close();
    }

    await browser.close();
})();
