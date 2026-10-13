"use strict";

window.PockerSchedule = (() => {
  function dateAt(value) { return new Date(`${value}T00:00:00Z`); }
  function addDays(value, days) {
    const date = dateAt(value);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().split("T")[0];
  }
  function dayDiff(first, second) { return Math.round((dateAt(second) - dateAt(first)) / 86400000); }
  function isWeekend(value) { return [0, 6].includes(dateAt(value).getUTCDay()); }
  function workingStart(start, includeWeekends = false) {
    while (!includeWeekends && isWeekend(start)) start = addDays(start, 1);
    return start;
  }
  function fromDays(days) {
    const segments = [];
    for (const [offsetDays, day] of days.entries()) {
      const previous = segments.at(-1);
      if (previous && addDays(previous.start, previous.durationDays) === day) previous.durationDays++;
      else segments.push({start: day, durationDays: 1, offsetDays});
    }
    return {start: days[0], end: days.at(-1), days, segments};
  }
  function activity(item) {
    const days = [];
    const includeWeekends = item.includeWeekends === true;
    let day = workingStart(item.start, includeWeekends);
    while (days.length < item.durationDays) {
      if (includeWeekends || !isWeekend(day)) days.push(day);
      if (days.length < item.durationDays) day = addDays(day, 1);
    }
    return fromDays(days);
  }
  function summary(activities) {
    return fromDays([...new Set(activities.flatMap(item => activity(item).days))].sort());
  }
  function visibleSegments(schedule, windowStart, windowDays, progress) {
    const completedDays = schedule.days.length * progress / 100;
    return schedule.segments.flatMap(segment => {
      const startOffset = dayDiff(windowStart, segment.start);
      const visibleStart = Math.max(0, startOffset);
      const visibleEnd = Math.min(windowDays, startOffset + segment.durationDays);
      if (visibleEnd <= visibleStart) return [];
      const completedInSegment = Math.max(0, Math.min(segment.durationDays, completedDays - segment.offsetDays));
      const visibleProgress = Math.max(0, Math.min(100, (startOffset + completedInSegment - visibleStart) / (visibleEnd - visibleStart) * 100));
      return [{start: addDays(windowStart, visibleStart), end: addDays(windowStart, visibleEnd - 1), offset: visibleStart, durationDays: visibleEnd - visibleStart, progress: visibleProgress}];
    });
  }
  return {dateAt, addDays, dayDiff, isWeekend, workingStart, activity, summary, visibleSegments};
})();
