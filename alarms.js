const DEFAULT_ALARM_LIMITS = {
    highPressureCmH2O: 40,
    highRR: 35,
    apneaSeconds: 20,
    lowMinuteVentilationLpm: 3,
    highMinuteVentilationLpm: 20,
    stabilizationSeconds: 5,
};

const ALARM_PRIORITY = {
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low',
};

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function evaluateAlarms(metrics = {}, limits = DEFAULT_ALARM_LIMITS) {
    const active = [];
    const configuredLimits = {
        ...DEFAULT_ALARM_LIMITS,
        ...(limits ?? {}),
    };

    const nowSec = isFiniteNumber(metrics.nowSec) ? metrics.nowSec : 0;
    const elapsedSec = isFiniteNumber(metrics.elapsedSec) ? metrics.elapsedSec : nowSec;

    const pip = metrics.pipCmH2O;
    const paw = metrics.pawCmH2O;
    const pressure = Math.max(
        isFiniteNumber(pip) ? pip : -Infinity,
        isFiniteNumber(paw) ? paw : -Infinity
    );

    const measuredRR = metrics.measuredRR;
    // VE is eligible only with the same current completed-volume snapshot used
    // by the monitor. A legacy numeric field alone is not provenance.
    const delivery = metrics.deliveredVentilation;
    const nonnegativeInteger = value => Number.isInteger(value) && value >= 0;
    const identityValid = delivery && ['asOfTick', 'simulationGeneration', 'modeGeneration',
        'historyRevision', 'completedCount'].every(key => nonnegativeInteger(delivery[key]));
    const validDelivery = delivery?.schemaVersion === 1
        && identityValid
        && delivery.source === 'live-completed-breath-volume'
        && delivery.volumeDefinition === 'inspiratory-volume-above-breath-start-residual'
        && delivery.estimator === 'rolling-volume-sum'
        && delivery.status === 'available' && delivery.reason === null
        && delivery.windowSeconds === 30 && delivery.observedSeconds === 30
        && isFiniteNumber(metrics.simulationStep_s) && metrics.simulationStep_s > 0
        && delivery.asOfTick >= Math.round(30 / metrics.simulationStep_s)
        && delivery.asOfTick === Math.round(nowSec / metrics.simulationStep_s)
        && delivery.windowEndTickInclusive === delivery.asOfTick
        && delivery.windowStartTickExclusive === delivery.asOfTick - Math.round(30 / metrics.simulationStep_s)
        && Array.isArray(delivery.eventIds) && delivery.eventIds.length === delivery.completedCount
        && delivery.eventIds.every(id => id && id.simulationGeneration === delivery.simulationGeneration
            && id.modeGeneration === delivery.modeGeneration && nonnegativeInteger(id.settingsGeneration)
            && Number.isInteger(id.breathId) && id.breathId > 0)
        && new Set(delivery.eventIds.map(id => JSON.stringify(id))).size === delivery.completedCount
        && delivery.asOfSimTime_s === nowSec
        && delivery.asOfTick === metrics.simulationTick
        && delivery.simulationGeneration === metrics.simulationGeneration
        && delivery.modeGeneration === metrics.modeGeneration
        && delivery.historyRevision === metrics.deliveryHistoryRevision
        && isFiniteNumber(delivery.sumVolumeL) && delivery.sumVolumeL >= 0
        && (delivery.completedCount > 0 || delivery.sumVolumeL === 0)
        && isFiniteNumber(delivery.valueLpm) && delivery.valueLpm === delivery.sumVolumeL * 2
        && delivery.valueLpm === metrics.minuteVentilationLpm;
    const minuteVentilation = validDelivery ? delivery.valueLpm : null;

    const lastBreathStartSec = isFiniteNumber(metrics.lastBreathStartSec)
        ? metrics.lastBreathStartSec
        : null;

    const timeSinceLastBreathSec = lastBreathStartSec === null
        ? nowSec
        : Math.max(0, nowSec - lastBreathStartSec);

    if (isFiniteNumber(pressure) && pressure > configuredLimits.highPressureCmH2O) {
        active.push({
            id: 'HIGH_PRESSURE',
            label: 'High pressure',
            priority: ALARM_PRIORITY.HIGH,
            value: pressure,
            limit: configuredLimits.highPressureCmH2O,
            unit: 'cmH2O',
            message: 'Airway pressure exceeds high pressure limit',
        });
    }

    if (isFiniteNumber(measuredRR) && measuredRR > configuredLimits.highRR) {
        active.push({
            id: 'HIGH_RR',
            label: 'High RR',
            priority: ALARM_PRIORITY.MEDIUM,
            value: measuredRR,
            limit: configuredLimits.highRR,
            unit: '/min',
            message: 'Measured respiratory rate exceeds high RR limit',
        });
    }

    if (timeSinceLastBreathSec > configuredLimits.apneaSeconds) {
        active.push({
            id: 'APNEA',
            label: 'Apnea',
            priority: ALARM_PRIORITY.HIGH,
            value: timeSinceLastBreathSec,
            limit: configuredLimits.apneaSeconds,
            unit: 's',
            message: 'No breath detected within apnea interval',
        });
    }

    const veAlarmsArmed = elapsedSec >= configuredLimits.stabilizationSeconds;

    if (
        veAlarmsArmed &&
        isFiniteNumber(minuteVentilation) &&
        minuteVentilation < configuredLimits.lowMinuteVentilationLpm
    ) {
        active.push({
            id: 'LOW_VE',
            label: 'Low VE',
            priority: ALARM_PRIORITY.MEDIUM,
            value: minuteVentilation,
            limit: configuredLimits.lowMinuteVentilationLpm,
            unit: 'L/min',
            message: 'Delivered VE over 30 s is below the low VE limit.',
        });
    }

    if (
        veAlarmsArmed &&
        isFiniteNumber(minuteVentilation) &&
        minuteVentilation > configuredLimits.highMinuteVentilationLpm
    ) {
        active.push({
            id: 'HIGH_VE',
            label: 'High VE',
            priority: ALARM_PRIORITY.MEDIUM,
            value: minuteVentilation,
            limit: configuredLimits.highMinuteVentilationLpm,
            unit: 'L/min',
            message: 'Delivered VE over 30 s is above the high VE limit.',
        });
    }

    return active;
}

function highestAlarmPriority(activeAlarms = []) {
    if (activeAlarms.some(alarm => alarm.priority === ALARM_PRIORITY.HIGH)) {
        return ALARM_PRIORITY.HIGH;
    }
    if (activeAlarms.some(alarm => alarm.priority === ALARM_PRIORITY.MEDIUM)) {
        return ALARM_PRIORITY.MEDIUM;
    }
    if (activeAlarms.some(alarm => alarm.priority === ALARM_PRIORITY.LOW)) {
        return ALARM_PRIORITY.LOW;
    }
    return null;
}

const AlarmEngine = {
    DEFAULT_ALARM_LIMITS,
    ALARM_PRIORITY,
    evaluateAlarms,
    highestAlarmPriority,
};

if (typeof window !== 'undefined') {
    window.AlarmEngine = AlarmEngine;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AlarmEngine;
}

export {
    DEFAULT_ALARM_LIMITS,
    ALARM_PRIORITY,
    evaluateAlarms,
    highestAlarmPriority,
};

export default AlarmEngine;
