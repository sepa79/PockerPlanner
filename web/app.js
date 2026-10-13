"use strict";

let workspace;
let planner;
let activePlanId = null;
const emptyPlanView = {id: null, name: "", description: "", streams: [], activityTypes: [], activities: [], issues: []};
let editorKind;
let editorId;
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

function dateAt(value) { return new Date(`${value}T00:00:00Z`); }
function iso(date) { return date.toISOString().slice(0, 10); }
function addDays(value, days) { const date = dateAt(value); date.setUTCDate(date.getUTCDate() + days); return iso(date); }
function dayDiff(first, second) { return Math.round((dateAt(second) - dateAt(first)) / 86400000); }
function today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function shortDate(value) { return dateAt(value).toLocaleDateString("en-GB", {day: "numeric", month: "short", timeZone: "UTC"}); }
function resolutionTime(value) { return value ? `<time datetime="${escapeHtml(value)}" title="${escapeHtml(value)}">${escapeHtml(new Date(value).toLocaleString("en-GB", {dateStyle: "medium", timeStyle: "short"}))}</time>` : "Not recorded"; }
function byId(collection, id) { return collection.find(item => item.id === id); }
function blockersForStream(streamId) { return planner.issues.filter(issue => issue.open && issue.blocker && (issue.scope === "ALL" || issue.streamIds.includes(streamId))); }
function openBlockers(activity) { return blockersForStream(activity.streamId); }
function isOverdue(activity) { return activity.progress < 100 && addDays(activity.start, activity.durationDays - 1) < today(); }
function uid() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join(""); }
function toast(message) { const element = document.getElementById("toast"); element.textContent = message; element.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove("show"), 3200); }

async function load() {
  const response = await fetch("/api/state", {cache: "no-store"});
  if (!response.ok) throw new Error("Could not load the plan");
  workspace = await response.json();
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

async function persist(draft) {
  if (!window.PockerAuth.canEdit) throw new Error("Sign in as PocketHive local-admin to edit");
  const response = await fetch("/api/state", {method: "PUT", headers: {"Content-Type": "application/json", ...window.PockerAuth.headers()}, body: JSON.stringify(draft)});
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 409) await load();
    throw new Error(result.error || "Could not save");
  }
  workspace = result;
  selectCurrentPlan();
  render();
  toast("Plan saved");
}

function renderStats() {
  const activities = planner.activities;
  const blocked = activities.filter(activity => openBlockers(activity).length && activity.progress < 100).length;
  const overdue = activities.filter(isOverdue).length;
  const progress = window.PockerProgress(activities) ?? 0;
  const cards = [["Activities", activities.length, ""], ["Progress", `${progress}%`, ""], ["Blocked", blocked, "alert"], ["Overdue", overdue, overdue ? "alert" : ""]];
  document.getElementById("stats").innerHTML = cards.map(([label, value, className]) => `<span class="stat ${className}"><span class="stat-value">${value}</span>${label}</span>`).join("");
  document.getElementById("issue-count").textContent = planner.issues.filter(issue => issue.open).length;
}

function trackDecorations(start, count, todayOffset, group = false) {
  let html = "";
  if (!group) for (let index = 0; index < count; index++) {
    const weekday = dateAt(addDays(start, index)).getUTCDay();
    if (weekday === 0 || weekday === 6) html += `<span class="weekend" style="left:${index * dayWidth}px;width:${dayWidth}px"></span>`;
  }
  if (todayOffset >= 0 && todayOffset < count) html += `<span class="today-line" style="left:${todayOffset * dayWidth + dayWidth / 2}px"></span>`;
  return html;
}

function renderGantt() {
  const gantt = document.getElementById("gantt");
  if (!gantt.clientWidth) return;
  const starts = planner.activities.map(activity => activity.start);
  if (timelineStart === null) timelineStart = addDays([today(), ...starts].sort()[0], -2);
  const count = visibleDays;
  const labelWidth = window.matchMedia("(max-width: 600px)").matches ? 155 : 230;
  const width = Math.max(1, gantt.clientWidth - labelWidth);
  dayWidth = width / count;
  const end = addDays(timelineStart, count - 1);
  document.getElementById("range-label").textContent = `${shortDate(timelineStart)} – ${shortDate(end)} ${dateAt(end).getUTCFullYear()}`;
  document.getElementById("range-days").value = String(visibleDays);
  const todayOffset = dayDiff(timelineStart, today());
  const header = Array.from({length: count}, (_, index) => {
    const date = addDays(timelineStart, index);
    const weekday = dateAt(date).toLocaleDateString("en-GB", {weekday: "short", timeZone: "UTC"});
    return `<span class="day ${date === today() ? "today" : ""}" style="width:${dayWidth}px">${weekday}<strong>${dateAt(date).getUTCDate()}</strong></span>`;
  }).join("");
  let html = `<div class="gantt-inner" style="--day-width:${dayWidth}px"><div class="gantt-row header"><div class="row-label">Stream / activity</div><div class="track" style="width:${width}px">${header}</div></div>`;
  for (const [streamIndex, stream] of planner.streams.entries()) {
    const blockedClass = blockersForStream(stream.id).length ? " blocked-stream" : "";
    const activities = planner.activities.filter(activity => activity.streamId === stream.id).sort((first, second) => first.start.localeCompare(second.start));
    const collapsed = collapsedStreams.get(activePlanId)?.has(stream.id) || false;
    const progress = window.PockerProgress(activities);
    const progressLabel = progress === null ? "—" : `${progress}%`;
    const progressTitle = progress === null ? "No activities" : "Overall progress · average of all activity percentages";
    let summary = "";
    if (collapsed && activities.length) {
      const first = activities[0].start;
      const last = activities.map(activity => addDays(activity.start, activity.durationDays - 1)).sort().at(-1);
      const startOffset = dayDiff(timelineStart, first);
      const endOffset = dayDiff(timelineStart, last) + 1;
      const visibleStart = Math.max(0, startOffset);
      const visibleEnd = Math.min(count, endOffset);
      const summaryWidth = (visibleEnd - visibleStart) * dayWidth - 4;
      const progressEnd = startOffset + (endOffset - startOffset) * progress / 100;
      const visibleProgress = Math.max(0, Math.min(100, (progressEnd - visibleStart) / Math.max(1, visibleEnd - visibleStart) * 100));
      const title = `${stream.name} · ${activities.length} activities · ${shortDate(first)} – ${shortDate(last)} · ${progressLabel} overall · Range includes gaps between activities`;
      if (summaryWidth > 0) summary = `<span class="stream-summary" style="left:${visibleStart * dayWidth + 2}px;width:${summaryWidth}px" title="${escapeHtml(title)}"><span class="stream-summary-fill" style="width:${visibleProgress}%"></span><span class="stream-summary-label">${escapeHtml(stream.name)}</span></span>`;
    }
    const activityGroupId = `stream-activities-${streamIndex}`;
    html += `<div class="gantt-row group${blockedClass}"><div class="row-label"><button class="stream-toggle" data-toggle-stream="${escapeHtml(stream.id)}" aria-expanded="${!collapsed}" aria-controls="${activityGroupId}" aria-label="${collapsed ? "Expand" : "Collapse"} ${escapeHtml(stream.name)}" title="${escapeHtml(stream.description)}"><span class="stream-chevron" aria-hidden="true">${collapsed ? "▸" : "▾"}</span><span class="stream-name">${escapeHtml(stream.name)}${blockedClass ? " ◇" : ""}</span></button><span class="stream-progress" title="${progressTitle}" aria-label="${escapeHtml(stream.name)} overall progress: ${progress === null ? "no activities" : progressLabel}">${progressLabel}</span><button class="stream-edit" data-edit="stream" data-id="${escapeHtml(stream.id)}" aria-label="Edit ${escapeHtml(stream.name)}">✎</button></div><div class="track" style="width:${width}px">${trackDecorations(timelineStart, count, todayOffset, true)}${summary}</div></div><div id="${activityGroupId}" ${collapsed ? "hidden" : ""}>`;
    for (const activity of activities) {
      const type = byId(planner.activityTypes, activity.typeId);
      const blockers = openBlockers(activity);
      const overdue = isOverdue(activity);
      const startOffset = dayDiff(timelineStart, activity.start);
      const visibleStart = Math.max(0, startOffset);
      const visibleEnd = Math.min(count, startOffset + activity.durationDays);
      const left = visibleStart * dayWidth + 2;
      const barWidth = (visibleEnd - visibleStart) * dayWidth - 4;
      const status = `${activity.progress}%${blockers.length ? " ◇" : overdue ? " !" : ""}`;
      const title = `${activity.name} · ${type.name} · ${shortDate(activity.start)} · ${activity.durationDays} full planned day(s) · ${blockers.length} blockers${overdue ? " · Overdue" : ""}`;
      const progressEnd = startOffset + activity.durationDays * activity.progress / 100;
      const visibleProgress = Math.max(0, Math.min(100, (progressEnd - visibleStart) / Math.max(1, visibleEnd - visibleStart) * 100));
      const bar = barWidth > 0 ? `<button class="bar ${activity.dateConfirmed ? "" : "tentative"} ${blockers.length ? "blocked" : ""}" style="left:${left}px;width:${barWidth}px;--bar-color:${type.color}" data-edit="activity" data-id="${escapeHtml(activity.id)}" title="${escapeHtml(title)}"><span class="bar-fill" style="width:${visibleProgress}%"></span><span class="bar-label">${barWidth > 85 ? escapeHtml(activity.name) : ""}</span><span class="bar-progress">${barWidth > 35 ? `${activity.progress}%` : ""}</span></button>` : "";
      html += `<div class="gantt-row activity-row${blockedClass}"><div class="row-label"><button class="activity-name" data-edit="activity" data-id="${escapeHtml(activity.id)}" title="${escapeHtml(title)}">${escapeHtml(activity.name)}</button><span class="activity-sub ${blockers.length || overdue ? "blocked-text" : ""}" title="${escapeHtml(title)}">${status}</span></div><div class="track" style="width:${width}px">${trackDecorations(timelineStart, count, todayOffset)}${bar}</div></div>`;
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
    const linked = activities.filter(activity => activity.issueIds.includes(issue.id));
    const names = [...new Set(linked.map(activity => byId(planner.streams, activity.streamId)?.name))].filter(Boolean);
    const scope = issue.scope === "ALL" ? "ALL" : issue.streamIds.map(id => byId(planner.streams, id).name).join(", ");
    const resolved = issue.open ? "" : `<span>RESOLVED <b>${resolutionTime(issue.resolvedAt)}</b></span>`;
    return `<article class="issue ${issue.open && issue.blocker ? "blocking-issue" : ""}"><div class="issue-labels"><span class="issue-kind ${issue.blocker ? "blocker" : ""}">${issue.blocker ? "Blocker" : "Issue"}</span><span class="issue-scope">${escapeHtml(scope)}</span></div><div class="issue-main"><div class="issue-top"><button class="issue-title" data-edit="issue" data-id="${escapeHtml(issue.id)}">${escapeHtml(issue.title)}</button><div class="issue-flags">${issue.open ? "" : `<span class="issue-status resolved">Closed</span>`}${issue.descriptionIncomplete ? `<span class="issue-status" title="The description is missing details; this label does not block work.">incomplete</span>` : ""}</div></div><p class="issue-desc">${escapeHtml(issue.description)}</p><div class="issue-foot"><span>DISCOVERED <b>${shortDate(issue.discovered)}</b></span>${resolved}<span>LINKED <b>${linked.length} activities / ${escapeHtml(names.join(", ") || "none")}</b></span>${issue.jiraUrl ? `<a href="${escapeHtml(issue.jiraUrl)}" target="_blank" rel="noopener noreferrer">Jira ↗</a>` : ""}</div></div></article>`;
  }).join("") : `<div class="empty">No ${issueStatusFilter === "active" ? "active" : "closed"} ${onlyBlockers ? "blockers" : "issues"}.</div>`;
}

function render() {
  renderAccess();
  document.getElementById("active-plan").innerHTML = workspace.plans.length ? workspace.plans.map(plan => `<option value="${escapeHtml(plan.id)}" ${plan.id === activePlanId ? "selected" : ""}>${escapeHtml(plan.name)}</option>`).join("") : `<option value="">No plans</option>`;
  document.getElementById("plan-list").innerHTML = workspace.plans.map(plan => `<article class="plan-card ${plan.id === activePlanId ? "selected" : ""}"><div class="plan-card-top"><button class="plan-name" data-select-plan="${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</button><button class="button button-outline" data-edit="plan" data-id="${escapeHtml(plan.id)}">${window.PockerAuth.canEdit ? "Edit" : "Details"}</button></div><p class="plan-description">${escapeHtml(plan.description)}</p><span class="form-hint">${plan.streams.length} streams · ${plan.activities.length} activities</span></article>`).join("") || `<div class="empty">No plans yet. Sign in as local-admin to create a plan or import JSON.</div>`;
  document.getElementById("today-label").textContent = shortDate(today());
  const unconfirmed = planner.activities.filter(activity => !activity.dateConfirmed).length;
  document.getElementById("date-notice").hidden = unconfirmed === 0;
  document.getElementById("date-notice-text").textContent = `${unconfirmed} unconfirmed date${unconfirmed === 1 ? "" : "s"} · Confirm dates in activity details`;
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

function area(name, label, value = "") {
  return `<div class="field"><label for="field-${name}">${label}</label><textarea id="field-${name}" name="${name}" maxlength="2000">${escapeHtml(value)}</textarea></div>`;
}

function select(name, label, options, value) {
  return `<div class="field"><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}">${options.map(option => `<option value="${escapeHtml(option.id)}" ${option.id === value ? "selected" : ""}>${escapeHtml(option.name)}</option>`).join("")}</select></div>`;
}

function openEditor(kind, id = null) {
  if (!id && !window.PockerAuth.canEdit) return toast("Sign in as PocketHive local-admin to edit");
  if (kind !== "plan" && !planner.id) { selectTab("plans"); toast("Create a plan first"); return; }
  if (kind === "activity" && (!planner.streams.length || !planner.activityTypes.length)) {
    selectTab("data");
    toast("Import a plan, or add a stream and an activity type first");
    return;
  }
  editorKind = kind;
  editorId = id;
  const collection = {activity: planner.activities, stream: planner.streams, type: planner.activityTypes, issue: planner.issues, plan: workspace.plans}[kind];
  const item = id ? byId(collection, id) : null;
  document.getElementById("editor-title").textContent = `${id ? window.PockerAuth.canEdit ? "Edit" : "Details:" : "New"} ${kind === "type" ? "activity type" : kind}`;
  document.getElementById("delete-item").hidden = !id || !window.PockerAuth.canEdit;
  document.querySelector("#editor-form .dialog-actions button[type=submit]").hidden = !window.PockerAuth.canEdit;
  if (kind === "plan") {
    fields.innerHTML = field("name", "Plan name", item?.name || "", "text", "required maxlength=160") + `<div class="field"><label for="field-description">Plan description / testing approach</label><textarea id="field-description" name="description" maxlength="12000" rows="12">${escapeHtml(item?.description || "")}</textarea></div>`;
  } else if (kind === "activity") {
    const issues = planner.issues.map(issue => `<label class="blocker-option"><input type="checkbox" name="issueIds" value="${escapeHtml(issue.id)}" ${item?.issueIds.includes(issue.id) ? "checked" : ""}>${escapeHtml(issue.title)}</label>`).join("");
    const progress = item?.progress ?? 0;
    const progressField = `<div class="field progress-field"><label for="field-progress">Progress · %</label><div class="progress-controls"><input id="field-progress-slider" type="range" min="0" max="100" step="1" value="${progress}" aria-label="Progress slider"><input id="field-progress" name="progress" type="number" min="0" max="100" step="1" value="${progress}" required><button id="progress-done" type="button" class="button button-outline" title="Set progress to 100%">Done</button></div></div>`;
    fields.innerHTML = field("name", "Activity name", item?.name || "", "text", "required maxlength=160") + `<div class="form-grid">${select("streamId", "Stream", planner.streams, item?.streamId)}${select("typeId", "Activity type", planner.activityTypes, item?.typeId)}${field("start", "Start date", item?.start || today(), "date", "required")}${field("durationDays", "Full planned duration · days", item?.durationDays ?? 1, "number", "required min=1 max=365 step=1")}${progressField}</div><p class="form-hint">Duration is the total calendar time planned, never the time left.</p><label class="check-field"><input type="checkbox" name="dateConfirmed" ${item?.dateConfirmed ? "checked" : ""}>Start date confirmed by team</label>${area("status", "Status / description", item?.status)}<span class="field-label">Linked issues</span><div class="blocker-list">${issues || "<span class='form-hint'>No issues yet. Add one from the main screen.</span>"}</div>${field("jiraUrl", "Jira ticket link · optional HTTPS", item?.jiraUrl || "", "url", "placeholder='https://…'")}${item?.jiraUrl ? `<a class="external-link" href="${escapeHtml(item.jiraUrl)}" target="_blank" rel="noopener noreferrer">Open Jira ticket ↗</a>` : ""}`;
    const progressInput = document.getElementById("field-progress");
    const progressSlider = document.getElementById("field-progress-slider");
    progressSlider.addEventListener("input", () => { progressInput.value = progressSlider.value; });
    progressInput.addEventListener("input", () => { if (progressInput.value !== "" && progressInput.validity.valid) progressSlider.value = progressInput.value; });
    document.getElementById("progress-done").addEventListener("click", () => { progressInput.value = "100"; progressSlider.value = "100"; });
  } else if (kind === "stream") {
    fields.innerHTML = field("name", "Stream name", item?.name, "text", "required maxlength=100") + area("description", "Purpose / context", item?.description);
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
    const syncTargets = () => { document.getElementById("scope-targets").hidden = scopeInput.value === "ALL"; };
    scopeInput.addEventListener("change", syncTargets);
    syncTargets();
  }
  fields.querySelectorAll("input, select, textarea, button").forEach(input => { input.disabled = !window.PockerAuth.canEdit; });
  editor.showModal();
  fields.querySelector("input:not([type=checkbox])")?.focus();
}

function formItem() {
  const values = new FormData(form);
  const text = name => String(values.get(name) || "").trim();
  if (editorKind === "plan") {
    const original = editorId ? byId(workspace.plans, editorId) : {id: uid(), streams: [], activityTypes: [], activities: [], issues: []};
    return {...original, name: text("name"), description: text("description")};
  }
  if (editorKind === "activity") return {id: editorId || uid(), name: text("name"), streamId: text("streamId"), typeId: text("typeId"), start: text("start"), durationDays: Number(text("durationDays")), progress: Number(text("progress")), dateConfirmed: values.has("dateConfirmed"), status: text("status"), issueIds: values.getAll("issueIds"), jiraUrl: text("jiraUrl")};
  if (editorKind === "stream") return {id: editorId || uid(), name: text("name"), description: text("description")};
  if (editorKind === "type") return {id: editorId || uid(), name: text("name"), color: text("color")};
  return {id: editorId || uid(), title: text("title"), description: text("description"), scope: text("scope"), streamIds: text("scope") === "ALL" ? [] : values.getAll("streamIds"), blocker: values.has("blocker"), discovered: text("discovered"), open: text("open") === "true", descriptionIncomplete: values.has("descriptionIncomplete"), jiraUrl: text("jiraUrl")};
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!window.PockerAuth.canEdit) return;
  const key = {activity: "activities", stream: "streams", type: "activityTypes", issue: "issues"}[editorKind];
  const item = formItem();
  try {
    if (editorKind === "plan") {
      await saveWorkspace(draft => { const index = draft.plans.findIndex(existing => existing.id === editorId); if (index >= 0) draft.plans[index] = item; else draft.plans.push(item); });
      activePlanId = item.id;
      timelineStart = null;
      selectCurrentPlan();
      render();
    } else {
      await save(draft => { const index = draft[key].findIndex(existing => existing.id === editorId); if (index >= 0) draft[key][index] = item; else draft[key].push(item); });
    }
    editor.close();
  } catch (error) { toast(error.message); }
});

document.getElementById("delete-item").addEventListener("click", async () => {
  if (!window.PockerAuth.canEdit) return;
  const key = {activity: "activities", stream: "streams", type: "activityTypes", issue: "issues"}[editorKind];
  if (editorKind === "stream" && planner.activities.some(activity => activity.streamId === editorId)) return toast("Move or delete this stream’s activities first");
  if (editorKind === "type" && planner.activities.some(activity => activity.typeId === editorId)) return toast("Move activities to another type first");
  if (!confirm(`Delete this ${editorKind}?`)) return;
  try {
    if (editorKind === "plan") await saveWorkspace(draft => { draft.plans = draft.plans.filter(plan => plan.id !== editorId); });
    else await save(draft => { draft[key] = draft[key].filter(item => item.id !== editorId); if (editorKind === "issue") for (const activity of draft.activities) activity.issueIds = activity.issueIds.filter(id => id !== editorId); });
    editor.close();
  } catch (error) { toast(error.message); }
});

document.getElementById("close-editor").addEventListener("click", () => editor.close());
document.getElementById("cancel-editor").addEventListener("click", () => editor.close());
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
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], {type: "application/json"}));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = "pockerplanner-plan.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById("import-json").addEventListener("click", async event => {
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
  if (!bar || event.button !== 0 || !window.PockerAuth.canEdit) return;
  const startX = event.clientX;
  const originalLeft = parseFloat(bar.style.left);
  bar.setPointerCapture(event.pointerId);
  const move = moveEvent => { bar.style.left = `${originalLeft + moveEvent.clientX - startX}px`; };
  const finish = async upEvent => {
    bar.removeEventListener("pointermove", move);
    bar.removeEventListener("pointerup", finish);
    bar.removeEventListener("pointercancel", cancel);
    const days = Math.round((upEvent.clientX - startX) / dayWidth);
    if (!days) { bar.style.left = `${originalLeft}px`; return; }
    ignoreClick = true;
    setTimeout(() => { ignoreClick = false; }, 100);
    try { await save(draft => { const activity = byId(draft.activities, bar.dataset.id); activity.start = addDays(activity.start, days); activity.dateConfirmed = false; }); }
    catch (error) { render(); toast(error.message); }
  };
  const cancel = () => { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", finish); bar.removeEventListener("pointercancel", cancel); bar.style.left = `${originalLeft}px`; };
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", finish);
  bar.addEventListener("pointercancel", cancel);
});

function renderAccess() {
  const identity = window.PockerAuth.identity;
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
  if (window.PockerAuth.identity.user) {
    try { await window.PockerAuth.logout(); render(); } catch (error) { toast(error.message); }
  } else document.getElementById("auth-dialog").showModal();
});
document.getElementById("auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await window.PockerAuth.login(document.getElementById("auth-username").value.trim());
    document.getElementById("auth-error").textContent = "";
    document.getElementById("auth-dialog").close();
    render();
  } catch (error) { document.getElementById("auth-error").textContent = error.message; }
});

async function start() {
  try { await window.PockerAuth.initialize(); } catch (error) { toast(error.message); }
  await load();
}

function renderBlockedAlert() {
  const alert = document.getElementById("blocked-alert");
  const allBlocked = planner.streams.length > 0 && planner.streams.every(stream => blockersForStream(stream.id).length > 0);
  if (allBlocked && !alertAcknowledged && !alert.open) alert.showModal();
  if ((!allBlocked || alertAcknowledged) && alert.open) alert.close();
}

document.getElementById("blocked-alert").addEventListener("cancel", event => event.preventDefault());
document.getElementById("acknowledge-blocked").addEventListener("click", () => { alertAcknowledged = true; document.getElementById("blocked-alert").close(); });
document.getElementById("show-blockers").addEventListener("click", () => { alertAcknowledged = true; document.getElementById("blocked-alert").close(); onlyBlockers = true; issueStatusFilter = "active"; renderIssues(); selectTab("issues"); history.replaceState(null, "", "#issues"); });
document.getElementById("blocker-filter").addEventListener("click", () => { onlyBlockers = !onlyBlockers; renderIssues(); });
document.getElementById("issue-status-filter").addEventListener("change", event => { issueStatusFilter = event.target.value; renderIssues(); });
start().catch(error => toast(error.message));
