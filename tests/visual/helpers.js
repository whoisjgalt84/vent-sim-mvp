// @ts-check
/**
 * Shared setup for visual tests.
 *
 * Patient controls occupy an independent panel/drawer (CLAUDE.md §5).
 * Open it explicitly before driving effort; narrow header actions require closing it.
 */

// The browser requests /favicon.ico on its own and the static server 404s it.
// Not a defect; the repo simply has no favicon.
const IGNORED_CONSOLE = [/favicon\.ico/];

/** Load the app, stop the animation loop, and wait for the test surface. */
export async function open(page) {
    const errors = [];
    const record = (text) => {
        if (!IGNORED_CONSOLE.some((re) => re.test(text))) errors.push(text);
    };
    page.on('pageerror', (e) => record(String(e)));
    page.on('console', (m) => {
        // A resource-load failure puts the URL in location(), not text() —
        // filtering on text alone silently lets favicon 404s through.
        if (m.type() === 'error') record(`${m.text()} ${m.location()?.url ?? ''}`);
    });
    page.on('response', (r) => {
        if (r.status() >= 400 && !IGNORED_CONSOLE.some((re) => re.test(r.url()))) {
            errors.push(`HTTP ${r.status()} ${r.url()}`);
        }
    });

    await page.goto('/index.html');
    await page.waitForFunction(() => typeof window.__vsim?.seek === 'function');
    await page.evaluate(() => window.__vsim.pause());
    return errors;
}

/**
 * Every local asset request, with its query string. Used to assert the
 * cache-bust invariant (CLAUDE.md §4.7) from the network side rather than by
 * reading source — this is what actually caught js/ventilator.js importing
 * lung-model.js without a ?v=, which made the browser fetch it twice.
 */
export function trackLocalRequests(page) {
    const urls = [];
    page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.origin === 'http://127.0.0.1:8899' && /\.(js|css)$/.test(u.pathname)) {
            urls.push(u.pathname + u.search);
        }
    });
    return urls;
}

/** Expand every collapsed control group in the left rail. */
export async function expandRail(page) {
    await page.$$eval('.controls [data-collapsible][data-collapsed]',
        (els) => els.forEach((el) => el.click()));
    if (!(await page.locator('#patient-panel').isVisible())) await page.locator('#btn-patient').click();
}

/** Set a range input and fire the input event the app listens for. */
export async function setRange(page, selector, value) {
    await page.$eval(selector, (el, v) => {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
}

/** Drive the effort controls. Must run before Teaching Mode is enabled. */
export async function enableEffort(page, { patientRR = 30, pmus = 6, neuralTi = 10 } = {}) {
    await expandRail(page);
    await page.click('#pmus-toggle');
    await setRange(page, '#pmus-max', pmus);
    await setRange(page, '#neural-ti', neuralTi);
    await setRange(page, '#patient-rr', patientRR);
}

export async function setMode(page, mode) {
    if ((await state(page)).teachingMode) await teachingMode(page);
    await page.click(`.mode-btn[data-mode="${mode}"]`);
}

export async function teachingMode(page) {
    const drawerOpen=page.viewportSize().width<1300 && await page.locator('#patient-panel').isVisible();
    if(drawerOpen)await page.locator('#patient-close').click();
    await page.click('#btn-teaching-mode');
    if(drawerOpen)await page.locator('#btn-patient').click();
}

/**
 * Advance exactly `seconds` of simulated time and render one frame.
 * This is what makes the screenshot deterministic — never use waitForTimeout.
 */
export async function seek(page, seconds) {
    return page.evaluate((s) => window.__vsim.seek(s), seconds);
}

export async function state(page) {
    return page.evaluate(() => window.__vsim.state());
}

/** Supported diagnostic settings, configured before reset; no fabricated signal. */
export async function setupEffort(page, options) {
    return page.evaluate(value => window.__vsim.setupEffort(value), options);
}

/** Retain current trigger history and neural phase; unlike seek, does not reset. */
export async function stepTicks(page, count) {
    return page.evaluate(value => window.__vsim.stepTicks(value), count);
}
