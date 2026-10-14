"use strict";

window.PocketWhatIf = ({plan, affects, today, changed}) => {
  const panel = document.getElementById("whatif-panel");
  const form = document.getElementById("whatif-form");
  const issueInput = document.getElementById("whatif-issue");
  const endInput = document.getElementById("whatif-end");
  const toggle = document.getElementById("whatif-toggle");
  const error = document.getElementById("whatif-error");
  let selectedPlan = null;
  let result = null;

  function calculate() {
    result = null;
    error.textContent = "";
    if (panel.hidden) return;
    try {
      result = window.PocketSchedule.forecast(plan(), today(), affects, {issueId: issueInput.value, endDate: endInput.value});
    } catch (failure) { error.textContent = failure.message; }
  }

  function update() {
    const currentPlan = plan();
    toggle.disabled = !currentPlan.id;
    if (selectedPlan !== currentPlan.id) {
      selectedPlan = currentPlan.id;
      result = null;
      panel.hidden = true;
      form.reset();
      endInput.value = today();
      error.textContent = "";
    }
    const selected = issueInput.value;
    const blockers = currentPlan.issues.filter(issue => issue.open && issue.blocker);
    issueInput.replaceChildren(...blockers.map(issue => new Option(issue.title, issue.id)));
    if (!panel.hidden || blockers.some(issue => issue.id === selected)) issueInput.value = selected;
    endInput.min = today();
    endInput.max = window.PocketSchedule.addDays(today(), 365);
    for (const input of [issueInput, endInput, document.getElementById("whatif-minus"), document.getElementById("whatif-plus")]) input.disabled = !blockers.length;
    document.getElementById("whatif-empty").hidden = blockers.length > 0;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    toggle.textContent = panel.hidden ? "What if?" : "Return to plan";
    calculate();
  }

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) endInput.value = today();
    update();
    changed();
    if (!panel.hidden) issueInput.focus();
  });
  function preview() {
    calculate();
    changed();
  }
  form.addEventListener("input", preview);
  form.addEventListener("submit", event => { event.preventDefault(); preview(); });
  for (const [id, step] of [["whatif-minus", -1], ["whatif-plus", 1]]) {
    document.getElementById(id).addEventListener("click", () => {
      if (!endInput.value) return;
      const next = window.PocketSchedule.addDays(endInput.value, step);
      if (next < endInput.min || next > endInput.max) return;
      endInput.value = next;
      preview();
    });
  }

  return {update, projection: () => result};
};
