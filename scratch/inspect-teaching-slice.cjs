const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
    const out = path.resolve(process.argv[2] || '../evidence/layout'); fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch();
    try {
        for (const [name, port] of [['before',8898], ['after',8899]]) {
            const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            const errors=[]; page.on('pageerror', e => errors.push(String(e)));
            await page.goto(`http://127.0.0.1:${port}/index.html`);
            await page.waitForFunction(() => window.__vsim);
            for (const width of [1440,1100,800,390]) {
                await page.setViewportSize({width,height:900});
                if (width < 1300 && await page.locator('#patient-close').isVisible()) await page.locator('#patient-close').click();
                for (const mode of ['vc-cmv','pc-cmv','PC-CSV','pc-cmva']) {
                    await page.evaluate(mode => __vsim.setupEffort({mode,pMusMax:0,patientRR:0}), mode);
                    await page.evaluate(() => __vsim.seek(14));
                    for (const teaching of [false,true]) {
                        if ((await page.evaluate(() => __vsim.state().teachingMode)) !== teaching) await page.locator('#btn-teaching-mode').click();
                        await page.screenshot({ path:path.join(out,`${name}-${width}-${mode}-${teaching?'teach':'standard'}.png`),fullPage:width<850 });
                        if (name==='after') console.log(JSON.stringify({width,mode,teaching,errors,...await page.evaluate(()=>({
                            overflow:document.documentElement.scrollWidth>innerWidth,
                            keys:[...document.querySelectorAll('.key-output')].map(el=>({label:el.querySelector('.param-row__label')?.textContent,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})),
                            waves:[...document.querySelectorAll('.waveform-panel')].map(el=>el.getBoundingClientRect().height)
                        }))}));
                    }
                }
            }
            await page.close();
        }
    } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
