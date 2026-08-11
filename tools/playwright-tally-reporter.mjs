/** Emit one machine-readable, fail-closed tally for the commissioned visual gate. */

class CommissionedTallyReporter {
    onBegin(_config, suite) {
        this.tests = suite.allTests();
    }

    onEnd() {
        let passed = 0;
        let failed = 0;

        for (const test of this.tests ?? []) {
            const result = test.results.at(-1);
            if (test.outcome() === 'expected' && result?.status === 'passed') passed++;
            else failed++;
        }

        console.log(`COMMISSIONED_VISUAL_TALLY ${passed} passed, ${failed} failed`);
    }
}

export default CommissionedTallyReporter;
