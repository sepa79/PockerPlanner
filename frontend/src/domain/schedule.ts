import type { Activity, Issue, Plan } from '../api/types'

export interface Segment {
  start: string
  durationDays: number
  offsetDays: number
}

export interface Pause {
  from: string
  resume: string
}

export interface CompletedRange {
  start: string
  end: string
  includeWeekends: boolean
}

export interface Schedule {
  start: string | undefined
  end: string | undefined
  days: string[]
  segments: Segment[]
  weekendRanges: [string, string][]
  pauses?: Pause[]
  completedRanges?: CompletedRange[]
  recordedCompletion?: boolean
  members?: ActivitySchedule[]
}

export interface ActivitySchedule extends Schedule {
  start: string
  end: string
}

export interface Schedules {
  activities: Map<string, ActivitySchedule>
  streams: Map<string, Schedule>
}

export interface Forecast {
  baseline: Schedules
  current: Schedules
  projected: Schedules
  changed: Map<string, { start: number; end: number }>
  blockerDelays: Map<string, number>
  baselineFinish: string | null
  projectedFinish: string | null
}

export interface VisibleSegment {
  start: string
  end: string
  offset: number
  durationDays: number
  progress: number
}

export interface Frame {
  offset: number
  durationDays: number
  gaps: { kind: 'pause' | 'weekend' | 'gap'; offset: number; durationDays: number; weekend?: boolean }[]
  work: VisibleSegment[]
}

export interface Timing {
  remainingDays: number
  forecast: ActivitySchedule | null
  elapsedDays: number | null
  blockedDays: number | null
}

type ActivityEstimate = Pick<Activity, 'start' | 'durationDays' | 'includeWeekends'>
type ActivityTiming = ActivityEstimate & Pick<Activity, 'progress' | 'startedAt' | 'completedAt' | 'blockerTrackingSince' | 'blockerIntervals'>
type Extension = { issueId: string; endDate: string }

interface Simulation {
  baseline: Schedules
  from: string
  interruptions: Map<string, Pause & { ranges: Pause[] }>
  completed: Map<string, ActivitySchedule>
  remainingForecast: boolean
  clampFinish: boolean
}

interface Member {
  schedule: Schedule
  days: Set<string>
}

function requireBounds(schedule: Schedule): asserts schedule is ActivitySchedule {
  if (!schedule.start || !schedule.end) throw new Error('A schedule needs working days.')
}

function requiredSchedule<Value extends Schedule>(schedules: Map<string, Value>, id: string): Value {
  const schedule = schedules.get(id)
  if (!schedule) throw new Error(`Missing schedule: ${id}`)
  return schedule
}

export function dateAt(value: string): Date { return new Date(`${value}T00:00:00Z`); }
export function addDays(value: string, days: number): string {
  const date = dateAt(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}
export function dayDiff(first: string, second: string): number { return Math.round((dateAt(second).getTime() - dateAt(first).getTime()) / 86400000); }
function requireDate(value: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(dateAt(value).getTime()) || dateAt(value).toISOString().slice(0, 10) !== value) throw new Error("Choose valid calendar dates.");
}
export function timestampDay(value: string | Date): string {
  const date = new Date(value);
  const day = `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  requireDate(day);
  return day;
}
export function isWeekend(value: string): boolean { return [0, 6].includes(dateAt(value).getUTCDay()); }
export function workingStart(start: string, includeWeekends = false): string {
  while (!includeWeekends && isWeekend(start)) start = addDays(start, 1);
  return start;
}
function fromDays(days: string[]): Schedule {
  const segments: Segment[] = [];
  for (const [offsetDays, day] of days.entries()) {
    const previous = segments.at(-1);
    if (previous && addDays(previous.start, previous.durationDays) === day) previous.durationDays++;
    else segments.push({start: day, durationDays: 1, offsetDays});
  }
  return {start: days[0], end: days.at(-1), days, segments, weekendRanges: []};
}
export function activity(item: ActivityEstimate): ActivitySchedule {
  const days: string[] = [];
  const includeWeekends = item.includeWeekends === true;
  let day = workingStart(item.start, includeWeekends);
  while (days.length < item.durationDays) {
    if (includeWeekends || !isWeekend(day)) days.push(day);
    if (days.length < item.durationDays) day = addDays(day, 1);
  }
  const result = fromDays(days);
  requireBounds(result);
  return {...result, weekendRanges: includeWeekends ? [[result.start, result.end]] : []};
}
export function summary(activities: ActivityEstimate[]): Schedule {
  return summarizeSchedules(activities.map(activity));
}
export function remainingDays(item: Pick<Activity, 'durationDays' | 'progress'>): number { return Math.ceil(item.durationDays * (100 - item.progress) / 100); }
function pausedOnDay(schedule: Schedule, day: string): boolean {
  return schedule.start !== undefined && schedule.end !== undefined && schedule.start <= day && day <= schedule.end && (schedule.pauses || []).some(range => range.from <= day && day < range.resume);
}
function worksOnDay(schedule: Schedule, days: Set<string>, day: string): boolean {
  return schedule.start !== undefined && schedule.end !== undefined && schedule.start <= day && day <= schedule.end && !pausedOnDay(schedule, day) && (days.has(day) || (schedule.completedRanges || []).some(range => range.start <= day && day <= range.end && (range.includeWeekends || !isWeekend(day))));
}
function summarizeSchedules(members: ActivitySchedule[]): Schedule {
  const days = [...new Set(members.flatMap(member => member.days.filter(day => !pausedOnDay(member, day))))].sort();
  return {...fromDays(days), start: members.map(member => member.start).sort()[0], end: members.map(member => member.end).sort().slice(-1)[0], weekendRanges: members.flatMap(member => member.weekendRanges), completedRanges: members.flatMap(member => member.completedRanges || []), members};
}
export function plan(document: Plan, simulation: Simulation | null = null): Schedules {
  const activities = new Map<string, ActivitySchedule>();
  const streams = new Map<string, Schedule>();
  const pendingStreams = new Map(document.streams.map(stream => [stream.id, stream]));
  while (pendingStreams.size) {
    let progressed = false;
    for (const [streamId, stream] of pendingStreams) {
      if (stream.dependsOn && !streams.has(stream.dependsOn)) continue;
      const items = document.activities.filter(item => item.streamId === streamId);
      const roots = items.filter(item => !item.dependsOn).sort((first, second) => workingStart(first.start, first.includeWeekends === true).localeCompare(workingStart(second.start, second.includeWeekends === true)) || Number(second.includeWeekends === true) - Number(first.includeWeekends === true) || first.id.localeCompare(second.id));
      let shift = 0;
      if (stream.dependsOn && roots.length) {
        const predecessor = requiredSchedule(streams, stream.dependsOn);
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
          let start = item.dependsOn ? addDays(requiredSchedule(activities, item.dependsOn).end, 1) : addDays(workingStart(item.start, item.includeWeekends === true), shift);
          let projected: ActivitySchedule;
          if (simulation) {
            if (item.startedAt && !item.dependsOn) start = stream.dependsOn ? addDays(requiredSchedule(streams, stream.dependsOn).end!, 1) : timestampDay(item.startedAt);
            const baseline = requiredSchedule(simulation.baseline.activities, activityId);
            const interruption = simulation.interruptions.get(activityId);
            const from = interruption ? interruption.from : simulation.from;
            if (simulation.clampFinish) start = [start, baseline.start].sort().slice(-1)[0];
            const affected = interruption !== undefined && item.progress < 100 && baseline.start < interruption.resume;
            if (item.progress === 100) projected = simulation.completed.get(activityId) || baseline;
            else if ((item.progress > 0 || item.startedAt) && (affected || start > baseline.start || simulation.remainingForecast)) {
              const remaining = Math.max(1, remainingDays(item));
              const anchor = item.startedAt ? timestampDay(item.startedAt) : baseline.start;
              const past = baseline.days.filter(day => day < from && day >= anchor);
              const firstFuture = simulation.remainingForecast && !simulation.clampFinish ? workingStart(start, item.includeWeekends === true) : baseline.days.find(day => day >= from) || from;
              let resume = [start, firstFuture, affected ? interruption.resume : from, simulation.remainingForecast ? simulation.from : from, item.startedAt ? anchor : start].sort().slice(-1)[0];
              let future = activity({...item, start: resume, durationDays: remaining});
              while (simulation.clampFinish && future.end < baseline.end) {
                resume = addDays(resume, 1);
                future = activity({...item, start: resume, durationDays: remaining});
              }
              const combined = fromDays([...new Set([...past, ...future.days])].sort());
            requireBounds(combined);
            projected = combined;
              projected.start = item.startedAt ? anchor : [baseline.start, future.start].sort()[0];
              projected.pauses = [...(baseline.pauses || []), ...(affected ? interruption.ranges : start > baseline.start ? [{from: firstFuture, resume: future.start}] : [])];
            } else {
              if (affected) start = [start, interruption.resume].sort().slice(-1)[0];
              projected = activity({...item, start});
              projected.pauses = [...(baseline.pauses || []), ...(affected ? interruption.ranges : [])];
            }
          } else projected = activity({...item, start});
          projected.weekendRanges = item.includeWeekends === true ? [[projected.start, projected.end]] : [];
          activities.set(activityId, projected);
          pendingActivities.delete(activityId);
          resolved = true;
        }
        if (!resolved) throw new Error("Invalid activity dependencies");
      }
      streams.set(streamId, summarizeSchedules([...items].sort((first, second) => first.id.localeCompare(second.id)).map(item => requiredSchedule(activities, item.id))));
      pendingStreams.delete(streamId);
      progressed = true;
    }
    if (!progressed) throw new Error("Invalid stream dependencies");
  }
  return {activities, streams};
}
export function finish(schedules: Schedules): string | null {
  return [...schedules.activities.values()].map(item => item.end).sort().slice(-1)[0] || null;
}
export function forecast(document: Plan, asOf: string, affects: (issue: Issue, activity: Activity) => boolean, extension: Extension | null = null): Forecast {
  requireDate(asOf);
  if (typeof affects !== "function") throw new Error("Supply the issue scope predicate.");
  if (extension !== null) {
    if (!extension || typeof extension !== "object" || Object.keys(extension).sort().join() !== "endDate,issueId") throw new Error("Choose a blocker and its assumed end date.");
    requireDate(extension.endDate);
    if (extension.endDate < asOf || dayDiff(asOf, extension.endDate) > 365) throw new Error("Blocker end must be today or within the next 365 calendar days.");
    if (!document.issues.some(issue => issue.id === extension.issueId && issue.open && issue.blocker)) throw new Error("Choose an active blocker.");
  }
  const baseline = plan(document);
  const completed = new Map<string, ActivitySchedule>();
  for (const item of document.activities) {
    if (item.progress === 100) {
      const original = requiredSchedule(baseline.activities, item.id);
      const pauses = (item.blockerIntervals || []).flatMap(interval => interval.endedAt ? [{from: timestampDay(interval.startedAt), resume: addDays(timestampDay(interval.endedAt), 1)}] : []);
      if (item.completedAt) {
        const end = timestampDay(item.completedAt);
        const start = item.startedAt ? timestampDay(item.startedAt) : [original.start, end].sort()[0];
        completed.set(item.id, {...original, start, end, days: original.days.filter(day => start <= day && day <= end), pauses, completedRanges: [{start, end, includeWeekends: item.includeWeekends === true}], recordedCompletion: true});
      } else completed.set(item.id, {...original, pauses});
    }
  }
  function interruptions(assumption: Extension | null): Simulation['interruptions'] {
    const result: Simulation['interruptions'] = new Map();
    for (const item of document.activities) {
      if (item.progress === 100) continue;
      const ranges = document.issues.filter(issue => issue.blocker && affects(issue, item) && issue.discovered <= asOf && (issue.open || issue.resolvedAt)).map(issue => {
      if (!issue.open && !issue.resolvedAt) throw new Error("A resolved blocker needs its recorded resolution.");
      return {from: issue.discovered, resume: issue.open ? addDays(assumption && issue.id === assumption.issueId ? assumption.endDate : asOf, 1) : addDays(timestampDay(issue.resolvedAt!), 1)};
    });
      for (const interval of item.blockerIntervals || []) {
        ranges.push({from: timestampDay(interval.startedAt), resume: addDays(interval.endedAt ? timestampDay(interval.endedAt) : asOf, 1)});
      }
      const valid = ranges.filter(range => range.resume > range.from);
      if (valid.length) result.set(item.id, {from: valid.map(range => range.from).sort()[0], resume: valid.map(range => range.resume).sort().slice(-1)[0], ranges: valid});
    }
    return result;
  }
  const unblocked = plan(document, {baseline, from: asOf, interruptions: new Map(), completed, remainingForecast: true, clampFinish: false});
  const current = plan(document, {baseline: unblocked, from: asOf, interruptions: interruptions(null), completed, remainingForecast: true, clampFinish: true});
  const projected = extension ? plan(document, {baseline: unblocked, from: asOf, interruptions: interruptions(extension), completed, remainingForecast: true, clampFinish: true}) : current;
  const blockerDelays = new Map(document.activities.map(item => [item.id, Math.max(0, dayDiff(requiredSchedule(unblocked.activities, item.id).end, requiredSchedule(projected.activities, item.id).end))]));
  const changed = new Map<string, {start: number; end: number}>(document.activities.flatMap(item => {
    const before = requiredSchedule(current.activities, item.id);
    const after = requiredSchedule(projected.activities, item.id);
    return before.start === after.start && before.end === after.end && before.days.join() === after.days.join() ? [] : [[item.id, {start: dayDiff(before.start, after.start), end: dayDiff(before.end, after.end)}]];
  }));
  return {baseline, current, projected, changed, blockerDelays, baselineFinish: finish(current), projectedFinish: finish(projected)};
}
export function visibleSegments(schedule: Schedule, windowStart: string, windowDays: number, progress: number): VisibleSegment[] {
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
function mergeRanges(ranges: Pause[]): Pause[] {
  const merged: Pause[] = [];
  for (const range of [...ranges].sort((first, second) => first.from.localeCompare(second.from))) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.resume) previous.resume = [previous.resume, range.resume].sort().slice(-1)[0];
    else merged.push({from: range.from, resume: range.resume});
  }
  return merged;
}
function countRangeDays(ranges: Pause[], before: string, weekends: boolean): number {
  return ranges.reduce((total, range) => {
    const length = Math.max(0, dayDiff(range.from, before < range.resume ? before : range.resume));
    let weekdays = Math.floor(length / 7) * 5;
    for (let offset = 0; offset < length % 7; offset++) {
      if (!isWeekend(addDays(range.from, offset))) weekdays++;
    }
    return total + (weekends ? length - weekdays : weekdays);
  }, 0);
}
function workDayCounter(members: Member[]): (before: string) => number {
  const days = [...new Set(members.flatMap(member => member.schedule.days.filter(day => worksOnDay(member.schedule, member.days, day))))].sort();
  const ranges = fromDays(days).segments.map(segment => ({from: segment.start, resume: addDays(segment.start, segment.durationDays), includeWeekends: true}));
  for (const member of members) {
    const pauses = [...(member.schedule.pauses || [])].sort((first, second) => first.from.localeCompare(second.from));
    if (!member.schedule.start || !member.schedule.end) continue;
    for (const range of member.schedule.completedRanges || []) {
      let from = [range.start, member.schedule.start].sort().slice(-1)[0];
      const resume = addDays([range.end, member.schedule.end].sort()[0], 1);
      for (const pause of pauses) {
        if (pause.resume <= from) continue;
        if (pause.from >= resume || from >= resume) break;
        if (pause.from > from) ranges.push({from, resume: pause.from, includeWeekends: range.includeWeekends});
        from = [from, pause.resume].sort().slice(-1)[0];
      }
      if (from < resume) ranges.push({from, resume, includeWeekends: range.includeWeekends});
    }
  }
  const weekdays = mergeRanges(ranges);
  const weekends = mergeRanges(ranges.filter(range => range.includeWeekends));
  return before => countRangeDays(weekdays, before, false) + countRangeDays(weekends, before, true);
}
export function frame(schedule: Schedule, windowStart: string, windowDays: number, progress: number): Frame | null {
  if (!schedule.start || !schedule.end) return null;
  const offset = Math.max(0, dayDiff(windowStart, schedule.start));
  const endOffset = Math.min(windowDays, dayDiff(windowStart, schedule.end) + 1);
  if (endOffset <= offset) return null;
  const members = (schedule.members || [schedule]).map(member => ({schedule: member, days: new Set(member.days)}));
  const completedRanges = schedule.completedRanges || [];
  const visibleWork: string[] = [];
  const gaps: Frame["gaps"] = [];
  for (let index = offset; index < endOffset; index++) {
    const day = addDays(windowStart, index);
    const weekend = isWeekend(day) && !(schedule.weekendRanges || []).some(([start, end]) => start <= day && day <= end);
    const working = members.some(member => worksOnDay(member.schedule, member.days, day));
    const paused = !working && members.some(member => pausedOnDay(member.schedule, day));
    const kind = paused ? "pause" : weekend ? "weekend" : working ? null : "gap";
    const blockedWeekend = paused && weekend;
    if (!kind) visibleWork.push(day);
    if (!kind) continue;
    const previous = gaps.at(-1);
    if (previous?.kind === kind && Boolean(previous.weekend) === blockedWeekend && previous.offset + previous.durationDays === index - offset) previous.durationDays++;
    else gaps.push({kind, offset: index - offset, durationDays: 1, ...(blockedWeekend ? {weekend: true} : {})});
  }
  const work = fromDays(schedule.members ? schedule.days : schedule.days.filter(day => !pausedOnDay(schedule, day)));
  let segments: VisibleSegment[];
  if (completedRanges.length) {
    const countBefore = workDayCounter(members);
    const completedDays = countBefore(addDays(schedule.end, 1)) * progress / 100;
    segments = visibleSegments(fromDays(visibleWork), windowStart, windowDays, 0).map(segment => ({...segment, progress: Math.max(0, Math.min(100, (completedDays - countBefore(segment.start)) / segment.durationDays * 100))}));
  } else segments = visibleSegments(work, windowStart, windowDays, progress);
  return {offset, durationDays: endOffset - offset, gaps, work: segments.map(segment => ({...segment, offset: segment.offset - offset}))};
}
export function timing(item: ActivityTiming, now = new Date().toISOString()): Timing {
  const nowTime = new Date(now).getTime();
  const startTime = item.startedAt ? new Date(item.startedAt).getTime() : null;
  const endTime = item.progress === 100 ? (item.completedAt ? new Date(item.completedAt).getTime() : null) : nowTime;
  const elapsedDays = startTime !== null && endTime !== null ? Math.max(0, endTime - startTime) / 86400000 : null;
  const intervals = startTime === null || endTime === null ? [] : (item.blockerIntervals || []).map((interval): [number, number] => [Math.max(startTime, new Date(interval.startedAt).getTime()), Math.min(endTime, interval.endedAt ? new Date(interval.endedAt).getTime() : nowTime)]).filter(([start, end]) => end > start).sort((first, second) => first[0] - second[0]);
  const merged: [number, number][] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  const blockedDays = item.blockerTrackingSince && elapsedDays !== null ? merged.reduce((total, [start, end]) => total + (end - start) / 86400000, 0) : null;
  const remaining = remainingDays(item);
  const forecast = item.progress < 100 ? activity({...item, start: item.progress > 0 || item.startedAt ? now.slice(0, 10) : item.start, durationDays: Math.max(1, remaining)}) : null;
  return {remainingDays: remaining, forecast, elapsedDays, blockedDays};
}
