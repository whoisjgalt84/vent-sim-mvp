/** Emit one machine-readable, fail-closed tally for the commissioned visual gate. */

class CommissionedTallyReporter {
    onBegin(_config, suite) {
        this.tests = suite.allTests();
    }

    onEnd() {
        let passed = 0;
        let failed = 0;
        let manualPassed = 0;
        let manualFailed = 0;

        for (const test of this.tests ?? []) {
            const result = test.results.at(-1);
            const manual = test.location.file.endsWith('manual-hold.spec.js');
            if (test.outcome() === 'expected' && result?.status === 'passed') {
                if (manual) manualPassed++; else passed++;
            } else { if (manual) manualFailed++; else failed++; }
        }

        console.log(`COMMISSIONED_VISUAL_TALLY ${passed} passed, ${failed} failed`);
        console.log(`MANUAL_HOLD_VISUAL_TALLY ${manualPassed} passed, ${manualFailed} failed`);
    }
}

export default CommissionedTallyReporter;
