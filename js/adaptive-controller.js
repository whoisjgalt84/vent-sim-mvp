/**
 * Generic educational, breath-to-breath pressure targeting (VSM-ADAPT-001).
 * No physics imports, operator queues, wall clock, or patient-state inputs.
 * Pressure commands are cmH2O above set PEEP; feedback is raw inspired mL.
 */
export const DEFAULT_ADAPTIVE_CONFIG = Object.freeze({
    minimumPressure_cmH2O: 5,
    maximumPressure_cmH2O: 25,
    initialPressure_cmH2O: 10,
    gain_cmH2O_per_mL: 0.01,
    maxStep_cmH2O: 2,
    deadband_mL: 10,
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegativeInteger = value => Number.isInteger(value) && value >= 0;
const positiveTarget = value => finite(value) && value > 0;
const clip = (value, low, high) => Math.min(high, Math.max(low, value));

function validatedConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new TypeError('Adaptive configuration must be an object.');
    }
    const keys = Object.keys(DEFAULT_ADAPTIVE_CONFIG);
    if (Object.keys(config).some(key => !keys.includes(key))) {
        throw new TypeError('Unknown adaptive configuration field.');
    }
    const result = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };
    if (!Object.values(result).every(finite)
        || result.minimumPressure_cmH2O < 0
        || result.maximumPressure_cmH2O <= result.minimumPressure_cmH2O
        || result.initialPressure_cmH2O < result.minimumPressure_cmH2O
        || result.initialPressure_cmH2O > result.maximumPressure_cmH2O
        || result.gain_cmH2O_per_mL <= 0
        || result.maxStep_cmH2O <= 0
        || result.deadband_mL < 0) {
        throw new RangeError('Invalid adaptive bounds, initial pressure, or tuning.');
    }
    return Object.freeze(result);
}

// Copy only the declared measurement context; never enumerate a simulator object.
function sourceContext(record) {
    return Object.freeze({
        mode: record.mode,
        simulationGeneration: record.simulationGeneration,
        modeGeneration: record.modeGeneration,
        settingsGeneration: record.settingsGeneration,
        breathId: record.breathId,
        epoch: record.epoch,
        startedAt_s: record.startedAt_s,
        completedAt_s: record.completedAt_s,
        boundarySampleIndex: record.boundarySampleIndex,
        applied_cmH2O: record.applied_cmH2O,
        commandVersion: record.commandVersion,
        targetVT_mL: record.targetVT_mL,
        appliedPeep_cmH2O: record.appliedPeep_cmH2O ?? null,
    });
}

export class AdaptiveController {
    #config;
    #initialized = false;
    #simulationGeneration = null;
    #modeGeneration = null;
    #epoch = 0;
    #targetVT_mL = null;
    #applied_cmH2O = null;
    #commandVersion = 0;
    #commandSourceIdentity = null;
    #pending = null;
    #latestDecision = null;
    #lastFeedback = null;
    #lastConsumedBreathId = 0;
    #lastCompletionAt_s = null;
    #invalidationReason = null;

    constructor(config = {}) {
        this.#config = validatedConfig(config);
    }

    /** Setup/reset is explicit so initialization can precede mandatory prefill. */
    reset({ simulationGeneration, modeGeneration, targetVT_mL }) {
        if (!nonnegativeInteger(simulationGeneration) || !nonnegativeInteger(modeGeneration)
            || !positiveTarget(targetVT_mL)) {
            throw new RangeError('Invalid adaptive reset identity or target.');
        }
        this.#initialized = true;
        this.#simulationGeneration = simulationGeneration;
        this.#modeGeneration = modeGeneration;
        this.#epoch = 0;
        this.#targetVT_mL = targetVT_mL;
        this.#applied_cmH2O = this.#config.initialPressure_cmH2O;
        this.#commandVersion = 0;
        this.#commandSourceIdentity = null;
        this.#pending = null;
        this.#latestDecision = null;
        this.#lastFeedback = null;
        this.#lastConsumedBreathId = 0;
        this.#lastCompletionAt_s = null;
        this.#invalidationReason = null;
        return this.snapshot;
    }

    /** An operator-input event invalidates observations, never the applied pressure. */
    invalidate(reason = 'SETTINGS_CHANGED') {
        if (!this.#initialized) return this.snapshot;
        this.#epoch++;
        this.#pending = null;
        this.#latestDecision = null;
        this.#invalidationReason = reason;
        return this.snapshot;
    }

    /** Called only at the actual breath boundary, after engine-owned queue resolution. */
    beginBreath({ targetVT_mL } = {}) {
        if (!this.#initialized) throw new Error('Adaptive controller has not been initialized.');
        if (!positiveTarget(targetVT_mL)) throw new RangeError('Invalid adaptive target.');
        const targetChanged = targetVT_mL !== this.#targetVT_mL;
        if (targetChanged) this.#latestDecision = null;
        this.#targetVT_mL = targetVT_mL;
        if (this.#pending && this.#pending.epoch === this.#epoch
            && this.#pending.targetVT_mL === targetVT_mL) {
            this.#applied_cmH2O = this.#pending.pressure_cmH2O;
            this.#commandVersion = this.#pending.commandVersion;
            this.#commandSourceIdentity = this.#pending.source;
        }
        this.#pending = null;
        return this.snapshot;
    }

    /**
     * Consume the trusted engine's canonical expiration-start publication.
     * `vt_mL` must be copied directly from record.measuredVT_mL, without rounding.
     * A current rejected ID is consumed too; repairing/replaying it is not a new breath.
     */
    consume(record, now_s) {
        const reject = (reason, source = null) => {
            const decision = Object.freeze({
                eligible: false, reason, source,
                targetVT_mL: source?.targetVT_mL ?? null,
                vt_mL: null, error_mL: null,
                pressureBefore_cmH2O: this.#applied_cmH2O,
                nextPressure_cmH2O: this.#pending?.pressure_cmH2O ?? this.#applied_cmH2O,
                increment_cmH2O: 0, bound: null,
            });
            this.#latestDecision = decision;
            return decision;
        };
        if (!this.#initialized) return reject('NOT_INITIALIZED');
        if (!record || typeof record !== 'object') return reject('INVALID_RECORD');
        if (record.mode !== 'pc-cmva') return reject('WRONG_MODE');
        if (record.simulationGeneration !== this.#simulationGeneration
            || record.modeGeneration !== this.#modeGeneration) return reject('GENERATION_MISMATCH');
        if (!nonnegativeInteger(record.settingsGeneration) || !Number.isInteger(record.breathId)
            || record.breathId <= 0 || !nonnegativeInteger(record.epoch)
            || !nonnegativeInteger(record.boundarySampleIndex)) return reject('INVALID_IDENTITY');
        const source = sourceContext(record);
        if (record.breathId <= this.#lastConsumedBreathId) return reject('DUPLICATE_OR_OUT_OF_ORDER', source);
        this.#lastConsumedBreathId = record.breathId;
        if (!finite(now_s) || now_s < 0 || !finite(record.startedAt_s)
            || !finite(record.completedAt_s) || record.startedAt_s < 0
            || record.startedAt_s >= record.completedAt_s) return reject('INVALID_TIMING', source);
        if (record.completedAt_s !== now_s) return reject('STALE_OR_FUTURE_PUBLICATION', source);
        if (this.#lastCompletionAt_s !== null && record.completedAt_s <= this.#lastCompletionAt_s) {
            return reject('DUPLICATE_OR_OUT_OF_ORDER', source);
        }
        this.#lastCompletionAt_s = record.completedAt_s;
        if (record.epoch !== this.#epoch) return reject('STALE_EPOCH', source);
        if (record.valid !== true || !Array.isArray(record.reasons) || record.reasons.length !== 0) {
            return reject('INELIGIBLE_SOURCE', source);
        }
        if (!finite(record.vt_mL) || record.vt_mL < 0) return reject('INVALID_VOLUME', source);
        if (record.applied_cmH2O !== this.#applied_cmH2O
            || record.commandVersion !== this.#commandVersion) return reject('COMMAND_MISMATCH', source);
        if (record.targetVT_mL !== this.#targetVT_mL) return reject('TARGET_MISMATCH', source);
        if (record.appliedPeep_cmH2O !== undefined
            && (!finite(record.appliedPeep_cmH2O) || record.appliedPeep_cmH2O < 0)) {
            return reject('INVALID_PEEP_CONTEXT', source);
        }

        const error_mL = record.targetVT_mL - record.vt_mL;
        const inDeadband = Math.abs(error_mL) <= this.#config.deadband_mL;
        const requestedIncrement_cmH2O = inDeadband ? 0
            : clip(this.#config.gain_cmH2O_per_mL * error_mL,
                -this.#config.maxStep_cmH2O, this.#config.maxStep_cmH2O);
        const nextPressure_cmH2O = clip(record.applied_cmH2O + requestedIncrement_cmH2O,
            this.#config.minimumPressure_cmH2O, this.#config.maximumPressure_cmH2O);
        const bound = nextPressure_cmH2O === this.#config.maximumPressure_cmH2O ? 'upper'
            : nextPressure_cmH2O === this.#config.minimumPressure_cmH2O ? 'lower' : null;
        const reason = inDeadband ? 'DEADBAND'
            : bound === 'upper' && error_mL > 0 ? 'UPPER_BOUND'
                : bound === 'lower' && error_mL < 0 ? 'LOWER_BOUND' : 'ADJUST_PRESSURE';
        this.#pending = Object.freeze({
            pressure_cmH2O: nextPressure_cmH2O,
            commandVersion: this.#commandVersion + 1,
            epoch: this.#epoch,
            targetVT_mL: record.targetVT_mL,
            source,
        });
        this.#lastFeedback = Object.freeze({
            source, epoch: record.epoch, targetVT_mL: record.targetVT_mL,
            vt_mL: record.vt_mL, error_mL,
        });
        this.#invalidationReason = null;
        this.#latestDecision = Object.freeze({
            eligible: true, reason, source, targetVT_mL: record.targetVT_mL,
            vt_mL: record.vt_mL, error_mL,
            pressureBefore_cmH2O: record.applied_cmH2O,
            nextPressure_cmH2O, requestedIncrement_cmH2O,
            increment_cmH2O: nextPressure_cmH2O - record.applied_cmH2O,
            bound,
        });
        return this.#latestDecision;
    }

    /** Immutable display/audit state. Retained feedback carries its own target and epoch. */
    get snapshot() {
        return Object.freeze({
            config: this.#config,
            initialized: this.#initialized,
            simulationGeneration: this.#simulationGeneration,
            modeGeneration: this.#modeGeneration,
            epoch: this.#epoch,
            targetVT_mL: this.#targetVT_mL,
            applied_cmH2O: this.#applied_cmH2O,
            commandVersion: this.#commandVersion,
            commandSourceIdentity: this.#commandSourceIdentity,
            pending: this.#pending,
            latestDecision: this.#latestDecision,
            lastFeedback: this.#lastFeedback,
            feedbackCurrent: this.#lastFeedback !== null
                && this.#lastFeedback.epoch === this.#epoch
                && this.#lastFeedback.targetVT_mL === this.#targetVT_mL,
            lastConsumedBreathId: this.#lastConsumedBreathId,
            lastCompletionAt_s: this.#lastCompletionAt_s,
            invalidationReason: this.#invalidationReason,
        });
    }
}
