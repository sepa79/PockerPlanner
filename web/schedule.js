"use strict";

window.PocketSchedule = (() => {
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
  function plan(document) {
    const activities = new Map();
    const streams = new Map();
    const pendingStreams = new Map(document.streams.map(stream => [stream.id, stream]));
    while (pendingStreams.size) {
      let progressed = false;
      for (const [streamId, stream] of pendingStreams) {
        if (stream.dependsOn && !streams.has(stream.dependsOn)) continue;
        const items = document.activities.filter(item => item.streamId === streamId);
        const roots = items.filter(item => !item.dependsOn).sort((first, second) => workingStart(first.start, first.includeWeekends === true).localeCompare(workingStart(second.start, second.includeWeekends === true)) || Number(second.includeWeekends === true) - Number(first.includeWeekends === true) || first.id.localeCompare(second.id));
        let shift = 0;
        if (stream.dependsOn && roots.length) {
          const predecessor = streams.get(stream.dependsOn);
          if (!predecessor.end) throw new Error("A predecessor stream needs activities");
          const anchor = workingStart(roots[0].start, roots[0].includeWeekends === true);
          const start = workingStart(addDays(predecessor.end, 1), roots[0].includeWeekends === true);
          shift = dayDiff(anchor, start);
        }
        const pendingActivities = new Map(items.map(item => [item.id, item]));
        while (pendingActivities.size) {
          let resolved = false;
          for (const [activityId, item] of pendingActivities) {
            if (item.dependsOn && !activities.has(item.dependsOn)) continue;
            const start = item.dependsOn ? addDays(activities.get(item.dependsOn).end, 1) : addDays(workingStart(item.start, item.includeWeekends === true), shift);
            activities.set(activityId, activity({...item, start}));
            pendingActivities.delete(activityId);
            resolved = true;
          }
          if (!resolved) throw new Error("Invalid activity dependencies");
        }
        streams.set(streamId, fromDays([...new Set(items.flatMap(item => activities.get(item.id).days))].sort()));
        pendingStreams.delete(streamId);
        progressed = true;
      }
      if (!progressed) throw new Error("Invalid stream dependencies");
    }
    return {activities, streams};
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
  return {dateAt, addDays, dayDiff, isWeekend, workingStart, activity, summary, plan, visibleSegments};
})();
