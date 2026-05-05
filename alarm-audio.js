export const DEFAULT_ALARM_AUDIO_SETTINGS = {
    enabled: true,
    highRepeatSec: 12,
    mediumRepeatSec: 30,
    silenceDurationSec: 120,
};

export function highestPriority(activeAlarms = []) {
    if (activeAlarms.some((alarm) => alarm.priority === 'high')) return 'high';
    if (activeAlarms.some((alarm) => alarm.priority === 'medium')) return 'medium';
    if (activeAlarms.some((alarm) => alarm.priority === 'low')) return 'low';
    return null;
}

export function alarmSignature(activeAlarms = []) {
    return activeAlarms
        .map((alarm) => alarm.id)
        .filter(Boolean)
        .sort()
        .join('|');
}

export function repeatIntervalForPriority(
    priority,
    settings = DEFAULT_ALARM_AUDIO_SETTINGS
) {
    if (priority === 'high') return settings.highRepeatSec;
    if (priority === 'medium') return settings.mediumRepeatSec;
    return settings.mediumRepeatSec;
}

export function shouldPlayAlarmSound({
    activeAlarms = [],
    nowSec = 0,
    audioEnabled = true,
    silencedUntilSec = 0,
    lastSoundAtSec = -Infinity,
    lastAlarmSignature = '',
    settings = DEFAULT_ALARM_AUDIO_SETTINGS,
} = {}) {
    if (!audioEnabled) return false;
    if (!activeAlarms.length) return false;
    if (nowSec < silencedUntilSec) return false;

    const priority = highestPriority(activeAlarms);
    const signature = alarmSignature(activeAlarms);

    if (signature && signature !== lastAlarmSignature) return true;

    const repeatSec = repeatIntervalForPriority(priority, settings);
    return nowSec - lastSoundAtSec >= repeatSec;
}
