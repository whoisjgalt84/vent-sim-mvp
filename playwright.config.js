// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Visual-regression config for vent-sim-mvp.
 *
 * Baselines are platform-tagged (e.g. `baseline-chromium-linux.png`), so a
 * baseline generated on Windows will NOT match one generated in CI. Generate
 * and update baselines inside the pinned Docker image:
 *
 *   npm run test:visual:docker -- --update-snapshots
 *
 * See docs/visual-testing.md.
 */
export default defineConfig({
    testDir: './tests/visual',

    // The app is deterministic under __vsim.seek(), so a retry that passes
    // means genuine flake — treat it as a bug, not a fact of life.
    retries: 0,
    workers: 1,

    // Fail the run if someone commits test.only.
    forbidOnly: !!process.env.CI,

    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

    use: {
        baseURL: 'http://127.0.0.1:8899',
        // Normally Playwright's own managed browser is used — that is what makes
        // baselines reproducible. CHROMIUM_PATH is an explicit custom-browser
        // override only.
        // Baselines generated against an overridden browser will NOT match CI.
        launchOptions: process.env.CHROMIUM_PATH
            ? { executablePath: process.env.CHROMIUM_PATH }
            : {},
        // Screenshot comparisons need a fixed viewport; 1440x900 matches the
        // scratch/shot.cjs harness so the two are visually comparable.
        viewport: { width: 1440, height: 900 },
        trace: 'retain-on-failure',
    },

    expect: {
        toHaveScreenshot: {
            // Tolerances are deliberately tight. Baselines are generated and
            // compared in the SAME pinned Docker image, where rendering is
            // byte-stable (the `determinism` tests assert exactly that), so
            // these only need to absorb antialiasing — not a moved trace.
            //
            // ⚠️ Mutation-checked: at maxDiffPixelRatio 0.002 / threshold 0.15
            // a waveform stroke change of 1.8 → 2.4 px passed unnoticed. If you
            // loosen these, re-run that mutation and prove the suite still goes
            // red. A visual suite that cannot fail is worse than none.
            maxDiffPixelRatio: 0.0002,
            threshold: 0.1,
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
        },
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    // The npm visual commands use tools/run-browser-tests.mjs for the same
    // bounded, ownership-aware server lifecycle as the 44-check browser gate.
});
