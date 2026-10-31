(function initTimezoneRules(global) {
  const FIXED_OFFSET_RULES = {
    // British Columbia stopped seasonal clock changes after the final
    // spring-forward on 2026-03-08. Older browsers may still ship tzdata
    // that incorrectly changes America/Vancouver back to UTC-8 in November.
    'America/Vancouver': {
      from: Date.UTC(2026, 2, 8, 10, 0),
      offsetMinutes: -7 * 60
    }
  };

  const pad = value => String(value).padStart(2, '0');

  function fixedOffsetAt(ms, timeZone) {
    const rule = FIXED_OFFSET_RULES[timeZone];
    return rule && ms >= rule.from ? rule.offsetMinutes : null;
  }

  function partsInZone(ms, timeZone) {
    const fixedOffset = fixedOffsetAt(ms, timeZone);
    if (fixedOffset !== null) {
      const shifted = new Date(ms + fixedOffset * 60000);
      return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes()
      };
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(ms));
    return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  }

  function dateKey(parts) {
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  }

  function localDateNow(timeZone) {
    return dateKey(partsInZone(Date.now(), timeZone));
  }

  function zoneOffsetMinutes(ms, timeZone) {
    const fixedOffset = fixedOffsetAt(ms, timeZone);
    if (fixedOffset !== null) return fixedOffset;
    const parts = partsInZone(ms, timeZone);
    return Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(ms / 60000) * 60000) / 60000);
  }

  function zoneOffsetMs(ms, timeZone) {
    return zoneOffsetMinutes(ms, timeZone) * 60000;
  }

  function zonedToUtc(date, time, timeZone) {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const wallClock = Date.UTC(year, month - 1, day, hour, minute);
    let guess = wallClock;
    for (let index = 0; index < 4; index++) {
      const next = wallClock - zoneOffsetMs(guess, timeZone);
      if (next === guess) break;
      guess = next;
    }
    return guess;
  }

  function formatterTimeZone(ms, timeZone) {
    const fixedOffset = fixedOffsetAt(ms, timeZone);
    return fixedOffset === null
      ? { date: new Date(ms), timeZone }
      : { date: new Date(ms + fixedOffset * 60000), timeZone: 'UTC' };
  }

  function formatTime(ms, timeZone) {
    const input = formatterTimeZone(ms, timeZone);
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: input.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(input.date);
  }

  function formatDate(ms, timeZone, withYear = false) {
    const input = formatterTimeZone(ms, timeZone);
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: input.timeZone,
      ...(withYear && { year: 'numeric' }),
      month: 'numeric',
      day: 'numeric',
      weekday: 'short'
    }).format(input.date);
  }

  function zoneOffsetLabel(timeZone, ms = Date.now()) {
    const minutes = zoneOffsetMinutes(ms, timeZone);
    const sign = minutes >= 0 ? '+' : '-';
    const absolute = Math.abs(minutes);
    return `UTC${sign}${Math.floor(absolute / 60)}${absolute % 60 ? `:${pad(absolute % 60)}` : ''}`;
  }

  global.TimezoneRules = Object.freeze({
    fixedOffsetAt,
    partsInZone,
    localDateNow,
    zoneOffsetMinutes,
    zoneOffsetMs,
    zonedToUtc,
    formatTime,
    formatDate,
    zoneOffsetLabel
  });
})(globalThis);
