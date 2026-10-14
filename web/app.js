"use strict";

let workspace;
let planner;
let activePlanId = null;
const emptyPlanView = {id: null, name: "", description: "", streams: [], activityTypes: [], activities: [], issues: []};
let editorKind;
let editorId;
let editorDraftId;
let editorRevision;
let liveUpdates;
let dragPending = false;
let schedules = {activities: new Map(), streams: new Map()};
let plannedSchedules = {activities: new Map(), streams: new Map()};
let scheduleDay = null;
let mutationPending = false;
let timelineStart = null;
let ignoreClick = false;
let onlyBlockers = false;
let issueStatusFilter = "active";
let alertAcknowledged = false;
const collapsedStreams = new Map();
let dayWidth = 44;
let visibleDays = window.matchMedia("(max-width: 600px)").matches ? 7 : 21;
const editor = document.getElementById("editor");
const fields = document.getElementById("editor-fields");
const form = document.getElementById("editor-form");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[character]);
}

const {dateAt, addDays, dayDiff} = window.PocketSchedule;
function today() { return window.PocketSchedule.timestampDay(new Date()); }
function shortDate(value) { return dateAt(value).toLocaleDateString("en-GB", {day: "numeric", month: "short", timeZone: "UTC"}); }
function resolutionTime(value) { return value ? `<time datetime="${escapeHtml(value)}" title="${escapeHtml(value)}">${escapeHtml(new Date(value).toLocaleString("en-GB", {dateStyle: "medium", timeStyle: "short"}))}</time>` : "Not recorded"; }
function byId(collection, id) { return collection.find(item => item.id === id); }
function issueAffects(issue, activity) { return issue.scope === "ALL" || (issue.scope === "STREAMS" ? issue.streamIds.includes(activity.streamId) : issue.activityIds.includes(activity.id)); }
function openBlockers(activity) { return planner.issues.filter(issue => issue.open && issue.blocker && issueAffects(issue, activity)); }
function blockersForStream(streamId) { return planner.issues.filter(issue => issue.open && issue.blocker && planner.activities.some(activity => activity.streamId === streamId && activity.progress < 100 && issueAffects(issue, activity))); }
function isOverdue(activity) { return activity.progress < 100 && plannedSchedules.activities.get(activity.id).end < today(); }
function automaticActivity(activity) { return Boolean(activity.dependsOn || byId(planner.streams, activity.streamId).dependsOn); }
function activityDepth(activity) {
  let depth = 0;
  for (let predecessor = activity.dependsOn; predecessor; predecessor = byId(planner.activities, predecessor).dependsOn) depth++;
  return depth;
}
function dependencyOptions(collection, currentId) {
  const indexed = new Map(collection.map(item => [item.id, item]));
  return [{id: "", name: "No dependency"}, ...collection.filter(candidate => {
    const visited = new Set();
    let current = candidate;
    while (current) {
      if (current.id === currentId || visited.has(current.id)) return false;
      visited.add(current.id);
      current = indexed.get(current.dependsOn);
    }
    return true;
  })];
}
function uid() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join(""); }
function toast(message) { const element = document.getElementById("toast"); element.textContent = message; element.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove("show"), 3200); }

const whatif = window.PocketWhatIf({plan: () => planner, affects: issueAffects, today: () => today(), changed: () => { renderPlanSummary(); renderGantt(); }});

function renderPlanSummary() {
  const preview = whatif.projection();
  const baselineFinish = window.PocketSchedule.finish(schedules);
  const finish = preview ? preview.projectedFinish : baselineFinish;
  const deadline = planner.deadline;
  const comparison = deadline && finish ? dayDiff(finish, deadline) : null;
  const outcome = comparison === null ? "No deadline comparison" : comparison < 0 ? `${-comparison} calendar days past deadline` : comparison === 0 ? "On deadline" : `${comparison} calendar days of margin`;
  document.getElementById("plan-summary").innerHTML = `<span>Deadline <strong>${deadline ? shortDate(deadline) + ` ${dateAt(deadline).getUTCFullYear()}` : "Not set"}</strong></span><span>Forecast finish <strong>${finish ? shortDate(finish) : "No activities"}</strong></span>${preview ? `<span class="preview-label">What if · ${preview.changed.size} activities changed${baselineFinish && finish ? ` · ${dayDiff(baselineFinish, finish)} days later` : ""}</span>` : ""}<span class="${comparison !== null && comparison < 0 ? "deadline-late" : ""}">${outcome}</span>`;
}

function frameContents(frame, fillClass) {
  const fills = frame.work.map(segment => `<span class="${fillClass}" style="left:${segment.offset * dayWidth}px;width:${segment.durationDays * dayWidth * segment.progress / 100}px"></span>`).join("");
  const gapTitles = {weekend: "Weekend · no work planned", pause: "Blocker / waiting period", gap: "No scheduled work"};
  const gaps = frame.gaps.map(gap => `<span class="bar-gap ${gap.kind}${gap.weekend ? " weekend" : ""}" aria-hidden="true" style="left:${gap.offset * dayWidth}px;width:${gap.durationDays * dayWidth}px" title="${gap.weekend ? "Weekend · " : ""}${gapTitles[gap.kind]}"></span>`).join("");
  return fills + gaps;
}

function frameLabel(text, className) {
  const reserve = className === "bar-label" ? 34 : 0;
  return `<span class="${className}" style="left:0;right:${reserve}px">${escapeHtml(text)}</span>`;
}

async function load() {
  const response = await fetch("/api/state", {cache: "no-store"});
  if (!response.ok) throw new Error("Could not load the plan");
  const result = await response.json();
  if (workspace && result.revision < workspace.revision) return;
  workspace = result;
  selectCurrentPlan();
  render();
  selectTab(location.hash.slice(1) || "plan");
}

async function save(change) {
  const draft = structuredClone(workspace);
  const plan = byId(draft.plans, activePlanId);
  if (!plan) throw new Error("Create or select a plan first");
  change(plan);
  await persist(draft);
}

async function saveWorkspace(change) {
  const draft = structuredClone(workspace);
  change(draft);
  await persist(draft);
}

function selectCurrentPlan() {
  const selected = workspace.plans.find(plan => plan.id === activePlanId);
  planner = selected || (workspace.plans.length ? workspace.plans[0] : emptyPlanView);
  activePlanId = planner.id;
}

async function persist(draft, endpoint = "/api/state") {
  if (mutationPending) throw new Error("Wait for the current update to finish.");
  if (!window.PocketAuth.canEdit) throw new Error("Sign in as PocketHive local-admin to edit");
  const controls = [...form.querySelectorAll("input, select, textarea, button")].map(element => ({element, disabled: element.disabled}));
  const submitButton = form.querySelector("button[type=submit]");
  const submitLabel = submitButton.textContent;
  mutationPending = true;
  if (editor.open && endpoint === "/api/state") draft.revision = editorRevision;
  form.setAttribute("aria-busy", "true");
  controls.forEach(({element}) => { element.disabled = true; });
  submitButton.textContent = "Saving…";
  try {
    const response = await fetch(endpoint, {method: "PUT", headers: {"Content-Type": "application/json", ...window.PocketAuth.headers()}, body: JSON.stringify(draft)});
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) {
        editor.close();
        await load();
        throw new Error("Plan changed elsewhere. Your edit was not saved. Reopen details to review the latest data.");
      }
      throw new Error(result.error || "Could not save");
    }
    workspace = result;
    selectCurrentPlan();
    render();
    toast("Plan saved");
  } finally {
    controls.forEach(({element, disabled}) => { element.disabled = disabled; });
    submitButton.textContent = submitLabel;
    form.setAttribute("aria-busy", "false");
    mutationPending = false;
    liveUpdates?.flush();
  }
}

function renderStats() {
  const activities = planner.activities;
  const blocked = activities.filter(activity => openBlockers(activity).length && activity.progress < 100).length;
  const overdue = activities.filter(isOverdue).length;
  const progress = window.PocketProgress(activities) ?? 0;
  const cards = [["Activities", activities.length, ""], ["Progress", `${progress}%`, ""], ["Blocked", blocked, "alert"], ["Overdue", overdue, overdue ? "alert" : ""]];
  document.getElementById("stats").innerHTML = cards.map(([label, value, className]) => `<span class="stat ${className}"><span class="stat-value">${value}</span>${label}</span>`).join("");
  document.getElementById("issue-count").textContent = planner.issues.filter(issue => issue.open).length;
}

function trackDecorations(start, count, todayOffset) {
  let html = "";
  for (let index = 0; index < count; index++) {
    if (window.PocketSchedule.isWeekend(addDays(start, index))) html += `<span class="weekend" style="left:${index * dayWidth}px;width:${dayWidth}px"></span>`;
  }
  if (todayOffset >= 0 && todayOffset < count) html += `<span class="today-line" style="left:${todayOffset * dayWidth + dayWidth / 2}px"></span>`;
  const deadlineOffset = planner.deadline ? dayDiff(start, planner.deadline) : -1;
  if (deadlineOffset >= 0 && deadlineOffset < count) html += `<span class="deadline-line" style="left:${(deadlineOffset + 1) * dayWidth - 1}px" title="Deadline ${escapeHtml(planner.deadline)}"></span>`;
  return html;
}

function renderGantt() {
  const gantt = document.getElementById("gantt");
  if (!gantt.clientWidth) return;
  const preview = whatif.projection();
  const displayed = preview ? preview.projected : schedules;
  gantt.classList.toggle("whatif-active", Boolean(preview));
  const activeBlockers = planner.issues.some(issue => issue.open && issue.blocker && planner.activities.some(activity => activity.progress < 100 && issueAffects(issue, activity)));
  document.getElementById("timeline-hint").textContent = preview ? `What if · Blocked through ${shortDate(document.getElementById("whatif-end").value)} · Red: pause · Grey: non-working weekend · Nothing saved` : `Red: pause · Grey: non-working weekend${activeBlockers ? " · Open blockers counted through today; forecast resumes no earlier than tomorrow" : " · Click to edit; drag to reschedule"}`;
  const starts = [...displayed.activities.values()].map(schedule => schedule.start);
  if (timelineStart === null) timelineStart = addDays([today(), ...starts].sort()[0], -2);
  const count = visibleDays;
  const labelWidth = window.matchMedia("(max-width: 600px)").matches ? 155 : 230;
  const width = Math.max(1, gantt.clientWidth - labelWidth);
  dayWidth = width / count;
  const end = addDays(timelineStart, count - 1);
  document.getElementById("range-label").textContent = `${shortDate(timelineStart)} – ${shortDate(end)} ${dateAt(end).getUTCFullYear()}`;
  document.getElementById("range-days").value = String(visibleDays);
  const todayOffset = dayDiff(timelineStart, today());
  const labelStride = Math.max(1, Math.ceil(23 / dayWidth));
  const header = Array.from({length: count}, (_, index) => {
    const date = addDays(timelineStart, index);
    const weekday = dateAt(date).toLocaleDateString("en-GB", {weekday: "short", timeZone: "UTC"});
    const labelled = index === todayOffset || (index % labelStride === 0 && (todayOffset < 0 || todayOffset >= count || Math.abs(index - todayOffset) >= labelStride));
    return `<span class="day ${date === today() ? "today" : ""} ${window.PocketSchedule.isWeekend(date) ? "weekend-day" : ""}" style="width:${dayWidth}px" title="${date} · ${weekday}">${dayWidth >= 28 ? weekday : ""}<strong>${labelled ? dateAt(date).getUTCDate() : ""}</strong></span>`;
  }).join("");
  let html = `<div class="gantt-inner" style="--day-width:${dayWidth}px"><div class="gantt-row header"><div class="row-label">Stream / activity</div><div class="track" style="width:${width}px">${header}</div></div>`;
  for (const [streamIndex, stream] of planner.streams.entries()) {
    const blockedClass = blockersForStream(stream.id).length ? " blocked-stream" : "";
    const activities = planner.activities.filter(activity => activity.streamId === stream.id).sort((first, second) => displayed.activities.get(first.id).start.localeCompare(displayed.activities.get(second.id).start));
    const collapsed = collapsedStreams.get(activePlanId)?.has(stream.id) || false;
    const progress = window.PocketProgress(activities);
    const progressLabel = progress === null ? "—" : `${progress}%`;
    const progressTitle = progress === null ? "No activities" : "Overall progress · average of all activity percentages";
    let summary = "";
    if (collapsed && activities.length) {
      const schedule = displayed.streams.get(stream.id);
      const title = `${stream.name} · ${activities.length} activities · ${shortDate(schedule.start)} – ${shortDate(schedule.end)} · ${progressLabel} overall · Scheduled days only`;
      const frame = window.PocketSchedule.frame(schedule, timelineStart, count, progress);
      summary = frame ? `<span class="stream-summary" data-start="${schedule.start}" data-end="${schedule.end}" style="left:${frame.offset * dayWidth + 2}px;width:${Math.max(1, frame.durationDays * dayWidth - 4)}px" title="${escapeHtml(title)}">${frameContents(frame, "stream-summary-fill")}${frameLabel(stream.name, "stream-summary-label")}</span>` : "";
    }
    const activityGroupId = `stream-activities-${streamIndex}`;
    const predecessorStream = stream.dependsOn ? byId(planner.streams, stream.dependsOn) : null;
    const streamTitle = `${stream.description}${predecessorStream ? ` · After ${predecessorStream.name}` : ""}`;
    const streamControls = `<button class="stream-toggle" data-toggle-stream="${escapeHtml(stream.id)}" aria-expanded="${!collapsed}" aria-controls="${activityGroupId}" aria-label="${collapsed ? "Expand" : "Collapse"} ${escapeHtml(stream.name)}" title="${escapeHtml(streamTitle)}"><span class="stream-chevron" aria-hidden="true">${collapsed ? "▸" : "▾"}</span><span class="stream-name">${escapeHtml(stream.name)}${predecessorStream ? " ↳" : ""}${blockedClass ? " ◇" : ""}</span></button><span class="stream-progress" title="${progressTitle}" aria-label="${escapeHtml(stream.name)} overall progress: ${progress === null ? "no activities" : progressLabel}">${progressLabel}</span><button class="stream-edit" data-edit="stream" data-id="${escapeHtml(stream.id)}" aria-label="Edit ${escapeHtml(stream.name)}">✎</button>`;
    html += `<div class="gantt-row group${blockedClass}"><div class="row-label">${streamControls}</div><div class="track" style="width:${width}px">${trackDecorations(timelineStart, count, todayOffset)}${summary}</div></div><div id="${activityGroupId}" ${collapsed ? "hidden" : ""}>`;
    for (const activity of activities) {
      const type = byId(planner.activityTypes, activity.typeId);
      const blockers = activity.progress < 100 ? openBlockers(activity) : [];
      const overdue = isOverdue(activity);
      const schedule = displayed.activities.get(activity.id);
      const delay = preview?.changed.get(activity.id);
      const automatic = automaticActivity(activity);
      const status = `${activity.progress}%${blockers.length ? " ◇" : overdue ? " !" : ""}`;
      const predecessor = activity.dependsOn ? byId(planner.activities, activity.dependsOn).name : byId(planner.streams, activity.streamId).dependsOn ? byId(planner.streams, byId(planner.streams, activity.streamId).dependsOn).name : null;
      const title = `${activity.name} · ${type.name} · Forecast ${shortDate(schedule.start)} – ${shortDate(schedule.end)} · Estimate finish ${shortDate(plannedSchedules.activities.get(activity.id).end)} · ${activity.durationDays} full planned ${activity.includeWeekends === true ? "calendar" : "working"} day(s) · ${blockers.length} open blockers${predecessor ? ` · After ${predecessor}` : ""}${overdue ? " · Past estimated finish" : ""}`;
      const frame = window.PocketSchedule.frame(schedule, timelineStart, count, activity.progress);
      const barWidth = frame ? Math.max(1, frame.durationDays * dayWidth - 4) : 0;
      const barTitle = preview ? `What if · ${title}${delay ? ` · Finish +${delay.end} calendar days` : ""}` : title;
      const bar = frame ? `<button class="bar ${activity.startedAt ? "" : "tentative"} ${blockers.length ? "blocked" : ""} ${automatic ? "dependent" : ""} ${schedule.recordedCompletion ? "recorded-completion" : ""}" style="left:${frame.offset * dayWidth + 2}px;width:${barWidth}px;--bar-color:${type.color}" data-edit="activity" data-id="${escapeHtml(activity.id)}" data-start="${schedule.start}" data-end="${schedule.end}" aria-label="${escapeHtml(barTitle)}" title="${escapeHtml(barTitle)}">${frameContents(frame, "bar-fill")}${frameLabel(activity.name, "bar-label")}<span class="bar-progress">${barWidth > 35 ? `${activity.progress}%` : ""}</span></button>` : "";
      const activityControls = `<button class="activity-name" style="--dependency-depth:${activityDepth(activity)}" data-edit="activity" data-id="${escapeHtml(activity.id)}" title="${escapeHtml(title)}">${escapeHtml(activity.name)}${automatic ? " ↳" : ""}</button><span class="activity-sub ${blockers.length || overdue ? "blocked-text" : ""}" title="${escapeHtml(title)}">${status}</span>`;
      html += `<div class="gantt-row activity-row${blockers.length ? " blocked-stream" : ""}"><div class="row-label">${activityControls}</div><div class="track" style="width:${width}px">${trackDecorations(timelineStart, count, todayOffset)}${bar}</div></div>`;
    }
    html += "</div>";
  }
  gantt.innerHTML = html + (planner.streams.length ? "" : `<div class="empty">No activities yet. Select or create a plan from Plans, or import a workspace from Data.</div>`) + "</div>";
}

function renderIssues() {
  const activities = planner.activities;
  const issues = planner.issues.filter(issue => issue.open === (issueStatusFilter === "active") && (!onlyBlockers || issue.blocker));
  document.getElementById("issue-status-filter").value = issueStatusFilter;
  document.getElementById("blocker-filter").textContent = onlyBlockers ? "Blockers only" : "All issues";
  document.getElementById("issues").innerHTML = issues.length ? issues.map((issue, index) => {
    const linked = activities.filter(activity => issueAffects(issue, activity));
    const names = [...new Set(linked.map(activity => byId(planner.streams, activity.streamId)?.name))].filter(Boolean);
    const scope = issue.scope === "ALL" ? "ALL" : issue.scope === "STREAMS" ? issue.streamIds.map(id => byId(planner.streams, id).name).join(", ") : linked.length ? `${linked.length} activities` : "No activities";
    const resolved = issue.open ? "" : `<span>RESOLVED <b>${resolutionTime(issue.resolvedAt)}</b></span>`;
    return `<article class="issue ${issue.open && issue.blocker ? "blocking-issue" : ""}"><div class="issue-labels"><span class="issue-kind ${issue.blocker ? "blocker" : ""}">${issue.blocker ? "Blocker" : "Issue"}</span><span class="issue-scope">${escapeHtml(scope)}</span></div><div class="issue-main"><div class="issue-top"><button class="issue-title" data-edit="issue" data-id="${escapeHtml(issue.id)}">${escapeHtml(issue.title)}</button><div class="issue-flags">${issue.open ? "" : `<span class="issue-status resolved">Closed</span>`}${issue.descriptionIncomplete ? `<span class="issue-status" title="The description is missing details; this label does not block work.">incomplete</span>` : ""}</div></div><p class="issue-desc">${escapeHtml(issue.description)}</p><div class="issue-foot"><span>DISCOVERED <b>${shortDate(issue.discovered)}</b></span>${resolved}<span>LINKED <b>${linked.length} activities / ${escapeHtml(names.join(", ") || "none")}</b></span>${issue.jiraUrl ? `<a href="${escapeHtml(issue.jiraUrl)}" target="_blank" rel="noopener noreferrer">Jira ↗</a>` : ""}</div></div></article>`;
  }).join("") : `<div class="empty">No ${issueStatusFilter === "active" ? "active" : "closed"} ${onlyBlockers ? "blockers" : "issues"}.</div>`;
}

function render() {
  scheduleDay = today();
  const forecast = window.PocketSchedule.forecast(planner, scheduleDay, issueAffects);
  plannedSchedules = forecast.baseline;
  schedules = forecast.projected;
  whatif.update();
  renderPlanSummary();
  renderAccess();
  document.getElementById("active-plan").innerHTML = workspace.plans.length ? workspace.plans.map(plan => `<option value="${escapeHtml(plan.id)}" ${plan.id === activePlanId ? "selected" : ""}>${escapeHtml(plan.name)}</option>`).join("") : `<option value="">No plans</option>`;
  document.getElementById("plan-list").innerHTML = workspace.plans.map(plan => `<article class="plan-card ${plan.id === activePlanId ? "selected" : ""}"><div class="plan-card-top"><button class="plan-name" data-select-plan="${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</button><button class="button button-outline" data-edit="plan" data-id="${escapeHtml(plan.id)}">${window.PocketAuth.canEdit ? "Edit" : "Details"}</button></div><p class="plan-description">${escapeHtml(plan.description)}</p><span class="form-hint">${plan.streams.length} streams · ${plan.activities.length} activities · Deadline ${plan.deadline ? escapeHtml(plan.deadline) : "not set"}</span></article>`).join("") || `<div class="empty">No plans yet. Sign in as local-admin to create a plan or import JSON.</div>`;
  document.getElementById("today-label").textContent = shortDate(today());
  renderStats();
  renderGantt();
  renderIssues();
  renderBlockedAlert();
  document.getElementById("stream-list").innerHTML = planner.streams.map(stream => `<button class="stream-row" data-edit="stream" data-id="${escapeHtml(stream.id)}"><strong>${escapeHtml(stream.name)}</strong><span class="stream-description">${escapeHtml(stream.description)}</span><span>${planner.activities.filter(activity => activity.streamId === stream.id).length} activities</span></button>`).join("") || `<div class="empty">No streams yet.</div>`;
  document.getElementById("type-list").innerHTML = planner.activityTypes.map(type => `<button class="type-row" data-type-id="${escapeHtml(type.id)}"><span style="--type-color:${type.color}"></span>${escapeHtml(type.name)}<span>EDIT ↗</span></button>`).join("") || `<div class="empty">No activity types yet.</div>`;
}

function field(name, label, value = "", type = "text", attributes = "") {
  return `<div class="field"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${attributes}></div>`;
}

function area(name, label, value = "", maximum = 2000) {
  return `<div class="field"><label for="field-${name}">${label}</label><textarea id="field-${name}" name="${name}" maxlength="${maximum}">${escapeHtml(value)}</textarea></div>`;
}

function select(name, label, options, value) {
  return `<div class="field"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}">${options.map(option => `<option value="${escapeHtml(option.id)}" ${option.id === value ? "selected" : ""}>${escapeHtml(option.name)}</option>`).join("")}</select></div>`;
}

function renderActivityTiming(original, draft, schedule, estimate, blockerDelay) {
  const actual = window.PocketSchedule.timing(original || draft);
  const projection = window.PocketSchedule.timing({...draft, start: schedule.start});
  const days = value => value === null ? "Not recorded" : `${Number(value.toFixed(2))} calendar days`;
  const unit = draft.includeWeekends ? "calendar" : "working";
  const startedPending = fields.querySelector("[name=started]").value === "true";
  const donePending = fields.querySelector("[name=done]").value === "true";
  const finish = projection.forecast ? shortDate(schedule.end) : original?.completedAt ? resolutionTime(original.completedAt) : donePending ? "On Save" : "Not recorded";
  document.getElementById("activity-timing").innerHTML = `<span>Estimate <strong>${draft.durationDays} ${unit} days</strong> · planned finish ${shortDate(estimate.end)}</span><span>Projected <strong>${finish}</strong>${projection.forecast ? ` · ≈ ${projection.remainingDays} ${unit} days left` : ""}</span><span id="activity-blocker-delay" title="Difference from the same forecast without blockers, including dependency effects; not recorded elapsed blocking time.">Blocker delay <strong>${projection.forecast ? `+${blockerDelay} calendar ${blockerDelay === 1 ? "day" : "days"}` : "Not projected"}</strong> · ${projection.forecast ? "estimated finish delay" : "no remaining-work forecast"}</span><span>Actual <strong>${days(actual.elapsedDays)}</strong>${original?.progress < 100 && original.startedAt ? " · so far" : ""}</span><span>Recorded blocking <strong>${days(actual.blockedDays)}</strong> · already included in actual time</span><span class="form-hint">Started: ${original?.startedAt ? resolutionTime(original.startedAt) : startedPending ? "On Save" : "Not recorded"} · Done: ${original?.completedAt ? resolutionTime(original.completedAt) : donePending ? "On Save" : "Not recorded"}</span><span class="form-hint">≈ estimate × remaining %. Forecast includes issue delays; open blockers last through today.${original?.blockerTrackingSince ? ` Blocking tracked since ${resolutionTime(original.blockerTrackingSince)}.` : " Actual blocking time is tracked from Started."}</span>`;
}

function openEditor(kind, id = null) {
  if (mutationPending) return;
  if (!id && !window.PocketAuth.canEdit) return toast("Sign in as PocketHive local-admin to edit");
  if (kind !== "plan" && !planner.id) { selectTab("plans"); toast("Create a plan first"); return; }
  if (kind === "activity" && (!planner.streams.length || !planner.activityTypes.length)) {
    selectTab("data");
    toast("Import a plan, or add a stream and an activity type first");
    return;
  }
  editorKind = kind;
  editorId = id;
  editorDraftId = id || uid();
  editorRevision = workspace.revision;
  const collection = {activity: planner.activities, stream: planner.streams, type: planner.activityTypes, issue: planner.issues, plan: workspace.plans}[kind];
  const item = id ? byId(collection, id) : null;
  document.getElementById("editor-title").textContent = `${id ? window.PocketAuth.canEdit ? "Edit" : "Details:" : "New"} ${kind === "type" ? "activity type" : kind}`;
  document.getElementById("delete-item").hidden = !id || !window.PocketAuth.canEdit;
  document.querySelector("#editor-form .dialog-actions button[type=submit]").hidden = !window.PocketAuth.canEdit;
  if (kind === "plan") {
    fields.innerHTML = field("name", "Plan name", item?.name || "", "text", "required maxlength=160") + field("deadline", "Deadline · optional target date", item?.deadline || "", "date") + `<p class="form-hint">The deadline stays fixed when activities move. Plan finish is calculated separately.</p><div class="field"><label for="field-description">Plan description / testing approach</label><textarea id="field-description" name="description" maxlength="12000" rows="12">${escapeHtml(item?.description || "")}</textarea></div>`;
  } else if (kind === "activity") {
    const issues = planner.issues.map(issue => `<label class="blocker-option"><input type="checkbox" name="issueIds" value="${escapeHtml(issue.id)}" ${issueAffects(issue, item || {id: editorDraftId, streamId: planner.streams[0].id}) ? "checked" : ""}>${escapeHtml(issue.title)}</label>`).join("");
    const progress = item?.progress ?? 0;
    const durationField = `<div class="field"><label for="field-durationDays">Full planned duration · working days</label><div class="duration-stepper"><button id="duration-minus" type="button" class="button button-outline" aria-label="Decrease planned duration by one day">−</button><input id="field-durationDays" name="durationDays" type="number" value="${item?.durationDays ?? 1}" required min="1" max="365" step="1"><button id="duration-plus" type="button" class="button button-outline" aria-label="Increase planned duration by one day">+</button></div></div>`;
    const progressField = `<div class="field progress-field"><label for="field-progress">Progress · %</label><div class="progress-controls"><button id="activity-started" type="button" class="button button-outline" aria-pressed="${Boolean(item?.startedAt)}" title="Record the actual start when saved">Started</button><input name="started" type="hidden" value="false"><input name="done" type="hidden" value="false"><input id="field-progress-slider" type="range" min="0" max="100" step="1" value="${progress}" aria-label="Progress slider"><input id="field-progress" name="progress" type="number" min="0" max="100" step="1" value="${progress}" required><button id="progress-done" type="button" class="button button-outline" title="Set 100% and record completion when saved">Done</button></div></div>`;
    fields.innerHTML = field("name", "Activity name", item?.name || "", "text", "required maxlength=160") + `<div class="form-grid">${select("streamId", "Stream", planner.streams, item?.streamId)}${select("typeId", "Activity type", planner.activityTypes, item?.typeId)}${field("start", "Planned start date", item?.start || window.PocketSchedule.workingStart(today()), "date", "required")}${durationField}</div>${progressField}<div id="activity-timing" class="activity-timing" aria-live="polite"></div><label class="check-field"><input type="checkbox" name="includeWeekends" aria-describedby="schedule-hint" ${item?.includeWeekends === true ? "checked" : ""}>Include weekends</label><p class="form-hint" id="schedule-hint"></p>${area("status", "Status / description", item?.status, 1000)}<span class="field-label">Linked issues</span><div class="blocker-list">${issues || "<span class='form-hint'>No issues yet. Add one from the main screen.</span>"}</div>${field("jiraUrl", "Jira ticket link · optional HTTPS", item?.jiraUrl || "", "url", "placeholder='https://…'")}${item?.jiraUrl ? `<a class="external-link" href="${escapeHtml(item.jiraUrl)}" target="_blank" rel="noopener noreferrer">Open Jira ticket ↗</a>` : ""}`;
    const startInput = document.getElementById("field-start");
    const durationInput = document.getElementById("field-durationDays");
    const weekendsInput = fields.querySelector("[name=includeWeekends]");
    const streamInput = fields.querySelector("[name=streamId]");
    const dependencyField = document.createElement("div");
    dependencyField.innerHTML = select("dependsOn", "Depends on · activity", dependencyOptions(planner.activities.filter(activity => activity.streamId === streamInput.value), editorDraftId), item?.dependsOn || "");
    fields.querySelector(".form-grid").append(dependencyField.firstElementChild);
    const dependencyInput = fields.querySelector("[name=dependsOn]");
    startInput.dataset.authoredStart = item?.start || startInput.value;
    const syncSchedule = () => {
      dependencyInput.setCustomValidity("");
      const automatic = Boolean(dependencyInput.value || byId(planner.streams, streamInput.value).dependsOn);
      if (!startInput.readOnly) startInput.dataset.authoredStart = startInput.value;
      startInput.readOnly = automatic;
      startInput.value = startInput.dataset.authoredStart;
      fields.querySelector("label[for=field-durationDays]").textContent = `Full planned duration · ${weekendsInput.checked ? "calendar" : "working"} days`;
      const hint = document.getElementById("schedule-hint");
      hint.textContent = "Duration is the full planned time, never the time left.";
      const progressInput = document.getElementById("field-progress");
      if (startInput.value && startInput.validity.valid && durationInput.value && durationInput.validity.valid && progressInput.value !== "" && progressInput.validity.valid) {
        const draft = structuredClone(planner);
        const preview = {...item, id: editorDraftId, streamId: streamInput.value, start: startInput.dataset.authoredStart, dependsOn: dependencyInput.value || null, durationDays: Number(durationInput.value), includeWeekends: weekendsInput.checked, progress: Number(document.getElementById("field-progress").value)};
        const index = draft.activities.findIndex(activity => activity.id === editorDraftId);
        if (index < 0) draft.activities.push(preview); else draft.activities[index] = preview;
        try {
          const forecast = window.PocketSchedule.forecast(draft, today(), issueAffects);
          const schedule = forecast.projected.activities.get(editorDraftId);
          startInput.dataset.scheduledStart = schedule.start;
          if (automatic) startInput.value = schedule.start;
          hint.textContent += ` Scheduled ${shortDate(schedule.start)} – ${shortDate(schedule.end)}.${automatic ? " Start follows the predecessor; move it or clear the dependency to reschedule." : ""}${weekendsInput.checked ? " Weekends included." : " Weekends stay free; weekend starts begin on Monday."}`;
          renderActivityTiming(item, preview, schedule, forecast.baseline.activities.get(editorDraftId), forecast.blockerDelays.get(editorDraftId));
        } catch (error) { dependencyInput.setCustomValidity(error.message); hint.textContent = error.message; }
      }
    };
    [startInput, durationInput, weekendsInput, dependencyInput].forEach(input => input.addEventListener("input", syncSchedule));
    for (const [id, step] of [["duration-minus", -1], ["duration-plus", 1]]) {
      document.getElementById(id).addEventListener("click", () => {
        if (!window.PocketAuth.canEdit || mutationPending || durationInput.disabled) return;
        if (!durationInput.validity.valid) { durationInput.reportValidity(); return; }
        durationInput.stepUp(step);
        durationInput.dispatchEvent(new Event("input", {bubbles: true}));
      });
    }
    streamInput.addEventListener("change", () => {
      const options = dependencyOptions(planner.activities.filter(activity => activity.streamId === streamInput.value), editorDraftId);
      dependencyInput.innerHTML = options.map(option => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.name)}</option>`).join("");
      fields.querySelectorAll("[name=issueIds]").forEach(input => { input.checked = issueAffects(byId(planner.issues, input.value), {id: editorDraftId, streamId: streamInput.value}); });
      syncSchedule();
    });
    syncSchedule();
    const progressInput = document.getElementById("field-progress");
    const progressSlider = document.getElementById("field-progress-slider");
    const progressChanged = () => { fields.querySelector("[name=done]").value = "false"; syncSchedule(); };
    progressSlider.addEventListener("input", () => { progressInput.value = progressSlider.value; progressChanged(); });
    progressInput.addEventListener("input", () => { if (progressInput.value !== "" && progressInput.validity.valid) { progressSlider.value = progressInput.value; progressChanged(); } });
    document.getElementById("activity-started").addEventListener("click", event => {
      if (item?.startedAt) return;
      const input = fields.querySelector("[name=started]");
      input.value = String(input.value !== "true");
      event.currentTarget.setAttribute("aria-pressed", input.value);
      syncSchedule();
    });
    document.getElementById("progress-done").addEventListener("click", () => { progressInput.value = "100"; progressSlider.value = "100"; fields.querySelector("[name=done]").value = "true"; syncSchedule(); });
  } else if (kind === "stream") {
    const predecessors = planner.streams.filter(stream => stream.id === item?.dependsOn || planner.activities.some(activity => activity.streamId === stream.id));
    fields.innerHTML = field("name", "Stream name", item?.name, "text", "required maxlength=100") + select("dependsOn", "Depends on · stream", dependencyOptions(predecessors, editorDraftId), item?.dependsOn || "") + `<p class="form-hint">The stream starts after its predecessor finishes. Activity spacing is preserved; linked activities follow their own predecessors.</p>` + area("description", "Purpose / context", item?.description);
  } else if (kind === "type") {
    fields.innerHTML = field("name", "Type name", item?.name, "text", "required maxlength=80") + field("color", "Timeline color", item?.color || "#ffc107", "color");
  } else {
    const targets = planner.streams.map(stream => `<label class="blocker-option"><input type="checkbox" name="streamIds" value="${escapeHtml(stream.id)}" ${item?.streamIds.includes(stream.id) ? "checked" : ""}>${escapeHtml(stream.name)}</label>`).join("");
    const isOpen = item?.open ?? true;
    const descriptionField = `<div class="field"><div class="issue-description-heading"><label for="field-description">Description</label><label class="check-field"><input type="checkbox" name="descriptionIncomplete" aria-describedby="incomplete-hint" ${item?.descriptionIncomplete ? "checked" : ""}>Incomplete</label></div><textarea id="field-description" name="description" maxlength="2000">${escapeHtml(item?.description || "")}</textarea><span class="form-hint" id="incomplete-hint">Marks missing details only; does not affect blockers or dates.</span></div>`;
    const resolved = isOpen ? "" : `<p class="form-hint">Resolved: ${resolutionTime(item?.resolvedAt)}</p>`;
    fields.innerHTML = field("title", "Issue title", item?.title, "text", "required maxlength=160") + descriptionField + `<label class="check-field"><input type="checkbox" name="blocker" ${item?.blocker ? "checked" : ""}>Blocker</label><div class="form-grid">${select("scope", "Affects", [{id:"ALL",name:"ALL streams"},{id:"STREAMS",name:"Selected streams"}], item?.scope || "ALL")}${field("discovered", "Discovered", item?.discovered || today(), "date", "required")}</div><div class="blocker-list" id="scope-targets">${targets}</div><div class="issue-lifecycle"><span>Status <span class="issue-status ${isOpen ? "" : "resolved"}">${isOpen ? "Open" : "Closed"}</span></span><input type="hidden" name="open" value="${isOpen}"><button type="button" id="issue-lifecycle-action" class="button button-outline" data-issue-open="${!isOpen}" title="Saves your edits and ${isOpen ? "closes" : "reopens"} this issue">${isOpen ? "Close issue" : "Reopen issue"}</button></div>${resolved}${field("jiraUrl", "Jira ticket link · optional HTTPS", item?.jiraUrl || "", "url", "placeholder='https://…'")}`;
    const openInput = fields.querySelector("[name=open]");
    const lifecycleAction = document.getElementById("issue-lifecycle-action");
    lifecycleAction.hidden = !id;
    lifecycleAction.addEventListener("click", () => {
      const current = openInput.value;
      openInput.value = lifecycleAction.dataset.issueOpen;
      try { form.requestSubmit(); } finally { openInput.value = current; }
    });
    const scopeInput = fields.querySelector("[name=scope]");
    scopeInput.insertAdjacentHTML("beforeend", `<option value="ACTIVITIES" ${item?.scope === "ACTIVITIES" ? "selected" : ""}>Selected activities</option>`);
    const activityTargets = document.createElement("div");
    activityTargets.id = "scope-activities";
    activityTargets.className = "blocker-list";
    activityTargets.innerHTML = planner.activities.map(activity => `<label class="blocker-option"><input type="checkbox" name="activityIds" value="${escapeHtml(activity.id)}" ${item?.activityIds?.includes(activity.id) ? "checked" : ""}>${escapeHtml(byId(planner.streams, activity.streamId).name)} / ${escapeHtml(activity.name)}</label>`).join("") || `<span class="form-hint">No activities yet.</span>`;
    document.getElementById("scope-targets").after(activityTargets);
    const syncTargets = () => { document.getElementById("scope-targets").hidden = scopeInput.value !== "STREAMS"; activityTargets.hidden = scopeInput.value !== "ACTIVITIES"; };
    scopeInput.addEventListener("change", syncTargets);
    syncTargets();
  }
  fields.querySelectorAll("input, select, textarea, button").forEach(input => { input.disabled = !window.PocketAuth.canEdit; });
  if (kind === "activity" && item?.startedAt) document.getElementById("activity-started").disabled = true;
  editor.showModal();
  fields.querySelector("input:not([type=checkbox])")?.focus();
}

function formItem() {
  const values = new FormData(form);
  const text = name => String(values.get(name) || "").trim();
  if (editorKind === "plan") {
    const original = editorId ? byId(workspace.plans, editorId) : {id: uid(), streams: [], activityTypes: [], activities: [], issues: []};
    return {...original, name: text("name"), description: text("description"), deadline: text("deadline") || null};
  }
  if (editorKind === "activity") return {id: editorDraftId, name: text("name"), streamId: text("streamId"), typeId: text("typeId"), start: fields.querySelector("[name=start]").dataset.authoredStart, dependsOn: text("dependsOn") || null, durationDays: Number(text("durationDays")), includeWeekends: values.has("includeWeekends"), progress: Number(text("progress")), started: text("started") === "true", done: text("done") === "true", status: text("status"), issueIds: values.getAll("issueIds"), jiraUrl: text("jiraUrl")};
  if (editorKind === "stream") return {id: editorDraftId, name: text("name"), description: text("description"), dependsOn: text("dependsOn") || null};
  if (editorKind === "type") return {id: editorId || uid(), name: text("name"), color: text("color")};
  return {id: editorId || uid(), title: text("title"), description: text("description"), scope: text("scope"), streamIds: text("scope") === "STREAMS" ? values.getAll("streamIds") : [], activityIds: text("scope") === "ACTIVITIES" ? values.getAll("activityIds") : [], blocker: values.has("blocker"), discovered: text("discovered"), open: text("open") === "true", descriptionIncomplete: values.has("descriptionIncomplete"), jiraUrl: text("jiraUrl")};
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!editor.open || mutationPending || !window.PocketAuth.canEdit) return;
  const key = {activity: "activities", stream: "streams", type: "activityTypes", issue: "issues"}[editorKind];
  const item = formItem();
  try {
    if (editorKind === "plan") {
      await saveWorkspace(draft => { const index = draft.plans.findIndex(existing => existing.id === editorId); if (index >= 0) draft.plans[index] = item; else draft.plans.push(item); });
      activePlanId = item.id;
      timelineStart = null;
      selectCurrentPlan();
      render();
    } else if (editorKind === "activity") {
      await persist({planId: activePlanId, activityId: editorId, item, expectedRevision: editorRevision}, "/api/activities");
    } else {
      await save(draft => { const index = draft[key].findIndex(existing => existing.id === editorId); if (index >= 0) draft[key][index] = item; else draft[key].push(item); });
    }
    editor.close();
  } catch (error) { toast(error.message); }
});

document.getElementById("delete-item").addEventListener("click", async () => {
  if (!editor.open || mutationPending || !window.PocketAuth.canEdit) return;
  const key = {activity: "activities", stream: "streams", type: "activityTypes", issue: "issues"}[editorKind];
  if (editorKind === "stream" && planner.activities.some(activity => activity.streamId === editorId)) return toast("Move or delete this stream’s activities first");
  if (editorKind === "type" && planner.activities.some(activity => activity.typeId === editorId)) return toast("Move activities to another type first");
  if (editorKind === "activity" && planner.activities.some(activity => activity.dependsOn === editorId)) return toast("Remove this activity’s dependencies first");
  if (editorKind === "stream" && planner.streams.some(stream => stream.dependsOn === editorId)) return toast("Remove this stream’s dependencies first");
  if (!confirm(`Delete this ${editorKind}?`)) return;
  try {
    if (editorKind === "plan") await saveWorkspace(draft => { draft.plans = draft.plans.filter(plan => plan.id !== editorId); });
    else await save(draft => { draft[key] = draft[key].filter(item => item.id !== editorId); if (editorKind === "issue") for (const activity of draft.activities) activity.issueIds = activity.issueIds.filter(id => id !== editorId); if (editorKind === "activity") for (const issue of draft.issues) if (issue.scope === "ACTIVITIES") issue.activityIds = issue.activityIds.filter(id => id !== editorId); });
    editor.close();
  } catch (error) { toast(error.message); }
});

function dismissOnBackdrop(dialog, canClose = () => true) {
  let pressedOutside = false;
  const outside = event => {
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  dialog.addEventListener("pointerdown", event => { pressedOutside = event.isPrimary && event.button === 0 && outside(event); });
  dialog.addEventListener("pointercancel", () => { pressedOutside = false; });
  dialog.addEventListener("close", () => { pressedOutside = false; });
  dialog.addEventListener("click", event => {
    const dismiss = pressedOutside && event.button === 0 && outside(event);
    pressedOutside = false;
    if (dismiss && canClose()) dialog.close();
  });
}

dismissOnBackdrop(editor, () => !mutationPending);
editor.addEventListener("close", () => liveUpdates?.flush());
dismissOnBackdrop(document.getElementById("auth-dialog"));
editor.addEventListener("cancel", event => { if (mutationPending) event.preventDefault(); });
document.getElementById("close-editor").addEventListener("click", () => { if (!mutationPending) editor.close(); });
document.getElementById("cancel-editor").addEventListener("click", () => { if (!mutationPending) editor.close(); });
document.getElementById("add-activity").addEventListener("click", () => openEditor("activity"));
document.getElementById("add-stream").addEventListener("click", () => openEditor("stream"));
document.getElementById("add-issue").addEventListener("click", () => openEditor("issue"));
document.getElementById("add-type").addEventListener("click", () => openEditor("type"));
document.getElementById("add-plan").addEventListener("click", () => openEditor("plan"));
document.getElementById("type-list").addEventListener("click", event => { const button = event.target.closest("[data-type-id]"); if (button) openEditor("type", button.dataset.typeId); });
document.getElementById("jump-today").addEventListener("click", () => { timelineStart = addDays(today(), -2); renderGantt(); });
document.getElementById("previous-range").addEventListener("click", () => { timelineStart = addDays(timelineStart, -visibleDays); renderGantt(); });
document.getElementById("next-range").addEventListener("click", () => { timelineStart = addDays(timelineStart, visibleDays); renderGantt(); });
document.getElementById("range-days").addEventListener("change", event => { visibleDays = Number(event.target.value); renderGantt(); });

document.getElementById("export-json").addEventListener("click", () => {
  const document = {...workspace, revision: 0};
  const url = URL.createObjectURL(new Blob([JSON.stringify(document)], {type: "application/json"}));
  const link = window.document.createElement("a");
  link.href = url;
  const name = planner.name.trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-").replace(/[. ]+$/, "") || "pocketplanner-plan";
  const safeName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
  link.download = `${safeName}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById("import-json").addEventListener("click", async event => {
  if (mutationPending) return;
  const file = document.getElementById("import-file").files[0];
  const result = document.getElementById("import-result");
  if (!file) { result.textContent = "Select a JSON file first."; return; }
  if (file.size > 1024 * 1024) { result.textContent = "The JSON file must be no larger than 1 MB."; return; }
  event.target.disabled = true;
  try {
    const imported = {...JSON.parse(await file.text()), revision: workspace.revision};
    if (!confirm("Replace all current plans with this JSON file?")) return;
    await persist(imported);
    timelineStart = null;
    alertAcknowledged = false;
    render();
    result.textContent = "Workspace imported and saved.";
    selectTab("plan");
  } catch (error) {
    result.textContent = `Import failed: ${error.message}`;
  } finally {
    event.target.disabled = false;
  }
});

function selectTab(name) {
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const selected = tabs.find(tab => tab.dataset.tab === name);
  if (!selected) return;
  for (const tab of tabs) {
    const active = tab === selected;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
  }
  if (name === "plan") renderGantt();
}

document.querySelector("[role=tablist]").addEventListener("click", event => {
  const tab = event.target.closest("[data-tab]");
  if (tab) { history.replaceState(null, "", `#${tab.dataset.tab}`); selectTab(tab.dataset.tab); }
});
document.querySelector("[role=tablist]").addEventListener("keydown", event => {
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const index = tabs.indexOf(event.target);
  if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click();
  tabs[next].focus();
});
window.addEventListener("hashchange", () => selectTab(location.hash.slice(1) || "plan"));
window.addEventListener("resize", () => { if (planner) renderGantt(); });

document.addEventListener("click", event => {
  const button = event.target.closest("[data-edit]");
  if (button && !ignoreClick) openEditor(button.dataset.edit, button.dataset.id);
});

document.getElementById("gantt").addEventListener("click", event => {
  const toggle = event.target.closest("[data-toggle-stream]");
  if (!toggle) return;
  const streamId = toggle.dataset.toggleStream;
  const collapsed = collapsedStreams.get(activePlanId) || new Set();
  if (collapsed.has(streamId)) collapsed.delete(streamId);
  else collapsed.add(streamId);
  collapsedStreams.set(activePlanId, collapsed);
  renderGantt();
  [...document.querySelectorAll("[data-toggle-stream]")].find(button => button.dataset.toggleStream === streamId).focus({preventScroll: true});
});

document.getElementById("gantt").addEventListener("pointerdown", event => {
  const bar = event.target.closest(".bar");
  if (!bar || event.button !== 0 || mutationPending || whatif.projection() || bar.classList.contains("recorded-completion") || !window.PocketAuth.canEdit) return;
  const startX = event.clientX;
  const activity = byId(planner.activities, bar.dataset.id);
  if (automaticActivity(activity)) return;
  dragPending = true;
  const originalStart = schedules.activities.get(activity.id).start;
  const segments = [...bar.closest(".activity-row").querySelectorAll(".bar")].map(element => ({element, left: parseFloat(element.style.left)}));
  const restore = () => { for (const segment of segments) segment.element.style.left = `${segment.left}px`; };
  bar.setPointerCapture(event.pointerId);
  const move = moveEvent => { for (const segment of segments) segment.element.style.left = `${segment.left + moveEvent.clientX - startX}px`; };
  const finish = async upEvent => {
    bar.removeEventListener("pointermove", move);
    bar.removeEventListener("pointerup", finish);
    bar.removeEventListener("pointercancel", cancel);
    const days = Math.round((upEvent.clientX - startX) / dayWidth);
    if (!days) { restore(); dragPending = false; liveUpdates?.flush(); return; }
    ignoreClick = true;
    setTimeout(() => { ignoreClick = false; }, 100);
    const start = window.PocketSchedule.workingStart(addDays(originalStart, days), activity.includeWeekends === true);
    if (start === activity.start) { restore(); dragPending = false; liveUpdates?.flush(); return; }
    try { await save(draft => { const target = byId(draft.activities, bar.dataset.id); target.start = start; }); }
    catch (error) { render(); toast(error.message); }
    finally { dragPending = false; liveUpdates?.flush(); }
  };
  const cancel = () => { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", finish); bar.removeEventListener("pointercancel", cancel); restore(); dragPending = false; liveUpdates?.flush(); };
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", finish);
  bar.addEventListener("pointercancel", cancel);
});

function renderAccess() {
  const identity = window.PocketAuth.identity;
  document.body.classList.toggle("read-only", !identity.canEdit);
  document.querySelectorAll(".edit-only").forEach(control => { control.hidden = !identity.canEdit; });
  document.getElementById("import-file").disabled = !identity.canEdit;
  const button = document.getElementById("auth-button");
  button.textContent = identity.user ? `${identity.user.username} · Sign out` : "View only · Sign in";
  button.disabled = !identity.configured;
  button.title = identity.configured ? "PocketHive session" : "Set POCKETHIVE_AUTH_BASE_URL to enable sign in";
}

document.getElementById("active-plan").addEventListener("change", event => { activePlanId = event.target.value; timelineStart = null; alertAcknowledged = false; selectCurrentPlan(); render(); });
document.getElementById("plan-list").addEventListener("click", event => {
  const button = event.target.closest("[data-select-plan]");
  if (!button) return;
  activePlanId = button.dataset.selectPlan;
  timelineStart = null;
  alertAcknowledged = false;
  selectCurrentPlan();
  render();
  selectTab("plan");
});
document.getElementById("close-auth").addEventListener("click", () => document.getElementById("auth-dialog").close());
document.getElementById("auth-button").addEventListener("click", async () => {
  if (window.PocketAuth.identity.user) {
    try { await window.PocketAuth.logout(); render(); } catch (error) { toast(error.message); }
  } else document.getElementById("auth-dialog").showModal();
});
document.getElementById("auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await window.PocketAuth.login(document.getElementById("auth-username").value.trim());
    document.getElementById("auth-error").textContent = "";
    document.getElementById("auth-dialog").close();
    render();
  } catch (error) { document.getElementById("auth-error").textContent = error.message; }
});

async function start() {
  try {
    const response = await fetch("/api/info", {cache: "no-store"});
    if (!response.ok) throw new Error("Could not load application version");
    const information = await response.json();
    if (!information || typeof information.version !== "string" || !information.version) throw new Error("Invalid application version response");
    document.getElementById("app-version").textContent = `v${information.version}`;
  } catch (error) {
    document.getElementById("app-version").textContent = "Version unavailable";
    toast(error.message);
  }
  try { await window.PocketAuth.initialize(); } catch (error) { toast(error.message); }
  await load();
  liveUpdates = window.PocketLive({revision: () => workspace.revision, blocked: () => editor.open || mutationPending || dragPending, apply: result => {
    const previousPlan = activePlanId;
    workspace = result;
    selectCurrentPlan();
    const removed = previousPlan && previousPlan !== activePlanId;
    if (removed) { timelineStart = null; alertAcknowledged = false; }
    render();
    toast(removed ? `Selected plan was removed. ${planner.id ? `Showing ${planner.name}.` : "No plans remain."}` : "Updated in another session");
  }, status: state => {
    const label = document.getElementById("live-status");
    label.dataset.state = state;
    label.textContent = {live: "Live", connecting: "Connecting…", pending: "Update waiting", unavailable: "Live updates unavailable"}[state];
    label.title = state === "pending" ? "Saved data changed elsewhere. Close details or finish the current edit to refresh." : state === "unavailable" ? "Reconnecting automatically; displayed data may be outdated." : "Automatic updates from other sessions";
  }});
}

function renderBlockedAlert() {
  const alert = document.getElementById("blocked-alert");
  const remaining = planner.activities.filter(activity => activity.progress < 100);
  const allBlocked = remaining.length > 0 && remaining.every(activity => openBlockers(activity).length > 0);
  if (allBlocked && !alertAcknowledged && !alert.open) alert.showModal();
  if ((!allBlocked || alertAcknowledged) && alert.open) alert.close();
}

document.getElementById("blocked-alert").addEventListener("cancel", event => event.preventDefault());
document.getElementById("acknowledge-blocked").addEventListener("click", () => { alertAcknowledged = true; document.getElementById("blocked-alert").close(); });
document.getElementById("show-blockers").addEventListener("click", () => { alertAcknowledged = true; document.getElementById("blocked-alert").close(); onlyBlockers = true; issueStatusFilter = "active"; renderIssues(); selectTab("issues"); history.replaceState(null, "", "#issues"); });
document.getElementById("blocker-filter").addEventListener("click", () => { onlyBlockers = !onlyBlockers; renderIssues(); });
document.getElementById("issue-status-filter").addEventListener("change", event => { issueStatusFilter = event.target.value; renderIssues(); });
start().catch(error => toast(error.message));

function refreshScheduleDay() {
  if (workspace && scheduleDay !== today() && !editor.open && !mutationPending && !dragPending) render();
}
setInterval(refreshScheduleDay, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshScheduleDay(); });
