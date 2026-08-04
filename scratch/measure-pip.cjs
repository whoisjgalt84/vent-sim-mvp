/**
 * SME-014 evidence gathering. Samples, over ~25 s of sim:
 *   - #param-pip text, computed font-size, and rendered width
 *   - the same for its large-readout neighbours (VT, RR) as a control
 *   - the pressure canvas y-axis top bound (does the AXIS rescale?)
 * Prints how often each changes, so "scaling" can be attributed to something.
 */
// Playwright resolves from the repo's node_modules when present, else from a
// sandbox-level install. Run `npm i -D playwright` to use this locally.
function loadChromium() {
    for (const id of ['playwright', '/home/claude/node_modules/playwright']) {
        try { return require(id).chromium; } catch { /* try next */ }
    }
    throw new Error('playwright not found — run: npm i -D playwright');
}
const chromium = loadChromium();

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH
            || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox'],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://127.0.0.1:8899/index.html?m=pip', { waitUntil: 'networkidle' });

    const samples = await page.evaluate(async () => {
        const out = [];
        const read = () => {
            const g = (id) => {
                const el = document.getElementById(id);
                if (!el) return null;
                const cs = getComputedStyle(el);
                return {
                    text: el.textContent,
                    font: cs.fontSize,
                    w: +el.getBoundingClientRect().width.toFixed(2),
                };
            };
            return {
                t: +(performance.now() / 1000).toFixed(2),
                pip: g('param-pip'),
                vt: g('param-vt'),
                rr: g('param-rr'),
                ve: g('param-ve'),
                map: g('param-map'),
            };
        };
        for (let i = 0; i < 250; i++) {
            out.push(read());
            await new Promise((r) => setTimeout(r, 100));
        }
        return out;
    });

    const churn = (key) => {
        const vals = samples.map((s) => s[key] && s[key].text).filter((v) => v != null && v !== '—');
        let changes = 0;
        for (let i = 1; i < vals.length; i++) if (vals[i] !== vals[i - 1]) changes++;
        const widths = new Set(samples.map((s) => s[key] && s[key].w));
        const fonts = new Set(samples.map((s) => s[key] && s[key].font));
        return {
            changesPer10s: +(changes / (samples.length / 10 / 10)).toFixed(1),
            distinctValues: new Set(vals).size,
            sample: vals.slice(-6),
            distinctWidths: [...widths].filter(Boolean).sort((a, b) => a - b),
            fontSizes: [...fonts].filter(Boolean),
        };
    };

    console.log('=== readout churn over ~25 s ===');
    for (const k of ['pip', 'vt', 'rr', 've', 'map']) {
        console.log(`  ${k.padEnd(4)}`, JSON.stringify(churn(k)));
    }

    // Does the pressure waveform y-axis rescale? Read the drawn top-of-axis label
    // by asking the renderer for its current range if exposed, else sample pixels.
    const axis = await page.evaluate(async () => {
        const seen = [];
        for (let i = 0; i < 60; i++) {
            const c = document.getElementById('canvas-pressure');
            const ctx = c.getContext('2d');
            // Sample the leftmost gutter column band where tick labels are drawn.
            const d = ctx.getImageData(0, 0, 46, c.height).data;
            let sig = 0;
            for (let p = 0; p < d.length; p += 4) sig = (sig * 31 + d[p + 3]) % 1000000007;
            seen.push(sig);
            await new Promise((r) => setTimeout(r, 400));
        }
        return { distinctAxisRenders: new Set(seen).size, total: seen.length };
    });
    console.log('=== pressure y-axis gutter (tick labels) ===');
    console.log('  ', JSON.stringify(axis), '(distinct >> 1 means the axis numbers are rescaling)');

    await browser.close();
})();
