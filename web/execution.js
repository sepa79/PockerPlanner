"use strict";

window.PocketExecution = ({root, item, changed, editable}) => {
  const startedButton = root.querySelector("#activity-started");
  const doneButton = root.querySelector("#progress-done");
  const progressInput = root.querySelector("#field-progress");
  const progressSlider = root.querySelector("#field-progress-slider");
  const startInput = root.querySelector("#field-startedAt");
  const finishInput = root.querySelector("#field-completedAt");
  const hint = root.querySelector("#execution-hint");
  const localDate = value => {
    const date = new Date(value);
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };
  startInput.value = item?.startedAt ? localDate(item.startedAt) : "";
  finishInput.value = item?.completedAt ? localDate(item.completedAt) : "";
  const originalStart = startInput.value;
  const originalFinish = finishInput.value;
  const dateFields = [[startInput, "startedAt", originalStart], [finishInput, "completedAt", originalFinish]];
  const offsets = {startedAt: root.querySelector("#field-startedAt-offset"), completedAt: root.querySelector("#field-completedAt-offset")};
  let started = Boolean(item?.startedAt);
  let done = item?.progress === 100;
  let startAction = null;
  let doneAction = null;
  const automaticDates = {startedAt: null, completedAt: null};

  function setDate(input, original, field) {
    input.value = original || localDate(new Date());
    automaticDates[field] = original ? null : input.value;
  }

  function actualTime(input, original, field, now) {
    if (!input.value) return null;
    if (input.value === automaticDates[field]) return now;
    const candidates = localTimes(input.value);
    const selected = candidates.length === 1 ? candidates[0] : candidates.find(date => String(date.getTimezoneOffset()) === offsets[field].value);
    if (!selected) return null;
    return input.value === original && selected.getTimezoneOffset() === new Date(item[field]).getTimezoneOffset() ? new Date(item[field]) : selected;
  }

  function localTimes(value) {
    const parsed = new Date(value);
    if (!value || !Number.isFinite(parsed.getTime())) return [];
    const normalized = value.length === 16 ? value + ":00" : value;
    const candidates = new Set([-1, 0, 1].map(day => new Date(parsed.getTime() + day * 86400000).getTimezoneOffset()));
    return [...candidates].map(offset => new Date(parsed.getTime() + (offset - parsed.getTimezoneOffset()) * 60000)).filter(date => localDate(date) === normalized).sort((first, second) => first - second);
  }

  function prepareOffsets(input, original, field, active) {
    const control = offsets[field];
    const candidates = localTimes(input.value);
    const date = input.value.slice(0, 10);
    const previous = control.dataset.date === date ? control.value : "";
    const recorded = original && original.slice(0, 10) === date ? String(new Date(item[field]).getTimezoneOffset()) : "";
    const repeated = candidates.length > 1 && input.value !== automaticDates[field];
    control.closest(".field").hidden = !active || !repeated;
    control.required = active && repeated;
    control.innerHTML = '<option value="">Choose UTC offset</option>' + candidates.map((candidate, index) => {
      const offset = candidate.getTimezoneOffset();
      const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
      const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
      return `<option value="${offset}">${index === 0 ? "Earlier" : "Later"} · UTC${offset <= 0 ? "+" : "-"}${hours}:${minutes}</option>`;
    }).join("");
    control.value = repeated ? [previous, recorded].find(value => candidates.some(candidate => String(candidate.getTimezoneOffset()) === value)) ?? "" : "";
    control.dataset.date = date;
  }

  function refresh() {
    startedButton.setAttribute("aria-pressed", String(started));
    doneButton.setAttribute("aria-pressed", String(done));
    startedButton.title = started ? "Undo Started and reset progress, actual dates and recorded blocking" : "Set the actual start";
    doneButton.title = done ? "Undo Done and enter the correct progress" : "Set 100% and the actual finish";
    startInput.closest(".field").hidden = !started;
    finishInput.closest(".field").hidden = !done;
    startInput.required = started && Boolean(originalStart || startAction);
    finishInput.required = done && Boolean(originalFinish || doneAction);
    progressInput.setCustomValidity(startAction === false && Number(progressInput.value) > 0 ? "Select Started before changing progress after a reset." : "");
    const now = new Date();
    for (const [input, field, original] of dateFields) prepareOffsets(input, original, field, field === "startedAt" ? started : done);
    const actualStart = actualTime(startInput, originalStart, "startedAt", now);
    const actualFinish = actualTime(finishInput, originalFinish, "completedAt", now);
    for (const [input, actual] of [[startInput, actualStart], [finishInput, actualFinish]]) {
      input.setCustomValidity("");
      if (input.value && !localTimes(input.value).length) input.setCustomValidity("Choose a valid local date and time.");
      else if (input.value && !actual) input.setCustomValidity("This local time occurs twice. Choose its UTC offset.");
      else if (actual > now) input.setCustomValidity("Actual dates cannot be in the future.");
    }
    if (actualStart && actualFinish && actualStart > actualFinish) finishInput.setCustomValidity("Actual finish cannot precede the actual start.");
    hint.hidden = !(doneAction === false && progressInput.value === "");
    hint.textContent = "Enter progress below 100% to undo Done. The start date stays unchanged.";
  }
  function notify() { refresh(); changed(); }
  function progressChanged() {
    if (!editable()) return;
    progressInput.setCustomValidity("");
    if (progressInput.value !== "" && progressInput.validity.valid) {
      progressSlider.value = progressInput.value;
      done = Number(progressInput.value) === 100;
      doneAction = done;
      if (done && !finishInput.value) setDate(finishInput, originalFinish, "completedAt");
      if (!done) finishInput.value = "";
    }
    notify();
  }
  progressSlider.addEventListener("input", () => { if (editable()) { progressInput.value = progressSlider.value; progressChanged(); } });
  progressInput.addEventListener("input", progressChanged);
  startedButton.addEventListener("click", () => {
    if (!editable()) return;
    started = !started;
    startAction = started;
    if (started) setDate(startInput, originalStart, "startedAt");
    else startInput.value = "";
    if (!started) {
      done = false;
      doneAction = false;
      finishInput.value = "";
      progressInput.value = "0";
      progressSlider.value = "0";
    }
    notify();
  });
  doneButton.addEventListener("click", () => {
    if (!editable()) return;
    done = !done;
    doneAction = done;
    if (done) setDate(finishInput, originalFinish, "completedAt");
    else finishInput.value = "";
    progressInput.value = done ? "100" : "";
    if (done) progressSlider.value = "100";
    notify();
    if (!done) progressInput.focus();
  });
  for (const [input, field] of [[startInput, "startedAt"], [finishInput, "completedAt"]]) input.addEventListener("input", () => { if (editable()) { automaticDates[field] = null; notify(); } });
  for (const control of Object.values(offsets)) control.addEventListener("change", () => { if (editable()) notify(); });
  refresh();
  return {
    valid: () => [startInput, finishInput].every(input => input.validity.valid),
    preview: () => {
      const draft = {...item, progress: Number(progressInput.value)};
      const now = new Date();
      for (const [input, field, original] of dateFields) {
        if (!(field === "startedAt" ? started : done) || !input.value) continue;
        const actual = actualTime(input, original, field, now);
        draft[field] = input.value === original && actual.getTime() === new Date(item[field]).getTime() ? item[field] : actual.toISOString();
      }
      if (!done) delete draft.completedAt;
      if (startAction === false) for (const field of ["startedAt", "completedAt", "blockerTrackingSince", "blockerIntervals"]) delete draft[field];
      return draft;
    },
    changes: () => {
      const actions = {};
      const now = new Date();
      if (startAction !== null) actions.started = startAction;
      if (doneAction !== null) actions.done = doneAction;
      for (const [input, field, original] of dateFields) {
        if (!(field === "startedAt" ? started : done) || !input.value || input.value === automaticDates[field]) continue;
        const actual = actualTime(input, original, field, now);
        if (input.value !== original || actual.getTime() !== new Date(item[field]).getTime()) actions[field] = actual.toISOString();
      }
      return actions;
    }
  };
};
