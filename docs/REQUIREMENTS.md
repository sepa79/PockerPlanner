# Product requirements

Live updates, blocker-impact previews and plan deadlines are available in v0.2.1. PocketHive run integration remains deferred under its separate [design](POCKETHIVE_INTEGRATION.md). The runtime and persisted contracts are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Live updates across sessions

Agreed on 2026-10-14. When someone saves a change in PocketPlanner, other people viewing the planner should see that change promptly without manually refreshing the page. Examples include moving an Activity, changing its dates or progress, and adding an Activity or Stream.

Updates apply to the relevant timeline, lists, dependency projections and summary counts. Connected read-only viewers can receive updates under the existing access policy; receiving updates never grants editing permission. Session presence, user lists and collaborative text editing are not required.

### Interaction requirements

- Reflect successfully persisted changes, including edits from the UI, imports through the application and scoped MCP updates. A failed save or an unsaved draft must not appear to other viewers as a committed update.
- Keep the viewer's selected plan, tab, calendar window, filters and collapsed Streams wherever those selections remain valid. Do not refresh the whole browser or unexpectedly switch plans.
- Give a compact indication that saved data changed; no interrupting dialog is needed for ordinary updates. Displaying who made the change requires real recorded attribution and is not part of this requirement.
- Do not silently overwrite an open editor's draft or give it a newer save revision. Its original revision must remain attached to the draft until explicit reconciliation. The server's existing conflict protection remains authoritative.
- Coordinate incoming updates with a pending save or drag. Do not move an item under the pointer, replay an old drag against new state or replace a newer saved response with an older notification.
- After a lost connection, reconnect and fetch current canonical state so missed updates are recovered. Make unavailable live updates visible rather than silently leaving a stale view.

### Implementation

Server-Sent Events at `/api/events` announce committed workspace revisions. Clients retrieve canonical state through the existing read API. One server observer checks the store revision every half-second, covering UI, MCP and explicit external replacements without a separate handler per write path. No bidirectional sockets or actor attribution are introduced.

The store remains the only persistence and revision authority. Observations see committed revisions only; notifications are not a second database, audit log or calculation source. Canonical revision comparisons reject old snapshots. Open editors, drags and pending saves defer refreshes without rebasing drafts; reconnects recover current state. Connection failure and queued updates have compact visible indicators.

### Verification before implementation is accepted

Use isolated synthetic databases and at least two independent browser sessions:

- One editor moves or adds an Activity; the other session's visible data updates without a manual refresh. Verify read-only viewing and an MCP-originated change too.
- A session editing a draft receives a remote update without losing or silently rebasing that draft. A stale save still follows explicit conflict handling.
- Concurrent saves, an in-progress drag and delayed/duplicate notifications do not lose changes or roll state back.
- A disconnected session catches up after reconnecting, preserves valid view selections and communicates connection failure while updates are unavailable.

The implementation is exercised by the live-feed, browser-controller and two-session browser regressions; mutations use isolated databases.

## Blocker impact simulation

Agreed concept on 2026-10-14. Management needs a read-only "What if?" view: if a blocker remains unresolved for an assumed additional period, show which Activities and Streams move, how far they move, and whether the plan misses its deadline. This is a scheduling projection, not a PocketHive execution scenario.

Keep the saved plan unchanged. Use one timeline and one frame per task, changing only the selected blocker's assumed end from today to the chosen day. Label the assumption and report the resulting finish/deadline impact, without duplicate baseline/projected lanes. A simulated date must never become a saved plan date or recorded actual start merely because someone viewed the simulation.

### Simulation behavior

- Select a blocker and an assumed inclusive end date, defaulting to today, with a calendar and adjacent ±1 day controls. Do not ask for the start of blocking or manual remaining effort. Work resumes on the next eligible day. Do not mix calendar days and working days silently.
- Use the issue's actual scope and targets to determine affected unfinished work. Propagate the impact through existing Activity and Stream dependencies; unrelated work does not shift merely because another Stream is blocked.
- Account for planned work that would not begin until after the assumed resolution anyway. Three more days of blocking does not automatically mean three days of delay for every Activity or for the whole plan.
- Reuse the authoritative calendar and dependency calculations, including each Activity's weekend setting. A working-day delay can span more calendar days; do not infer public holidays or hidden resource constraints.
- Completed work and recorded actual starts stay fixed. In-progress work extends using the explicitly agreed approximate remaining effort: full estimate × (100% − done), rounded up to scheduled days. This is a forecast assumption, never an actual elapsed-time measurement.
- Compare expected finishes per Activity, Stream and plan, identify unchanged work, and show the resulting calendar-date difference. Report delay separately from whether the plan deadline is exceeded.
- Keep the projection tied to the baseline revision. If the real plan changes while a simulation is open, make the projection's staleness explicit and reconcile or recalculate; never turn old assumptions into a real save.

### Implemented preview

The compact What if panel selects an active blocker and Assumed blocker end. A calendar picker and −1/+1 day buttons immediately update the existing timeline, without Preview or manual remaining-work inputs. There is one frame per Activity/Stream, containing grey non-working weekends and red pause sections without repeated letters or hatching. Names stay fixed to the frame start; enabled working weekends keep normal Activity styling. Dependency propagation and deadline margin/overrun remain visible. Normal Plan already forecasts active blocking through today, with resumption no earlier than tomorrow. What if uses the same engine and changes only the chosen blocker's end; nothing is saved. Today as the assumption gives exactly the normal forecast. Known closure days retain delays.

The preview treats 0% without a saved Started as not started, 100% as fixed, and intermediate progress or a recorded start as work in progress. Remaining effort is approximated from full estimate and percentage, as agreed on 2026-10-14. Start/past work is retained; future work resumes after resolution and delayed predecessors. A blocker never brings a finish forward. A changed workspace recalculates the assumption; closing/removing the selected blocker requires explicit reselection. Completed work uses recorded actual dates when available, never guessed execution facts.

The panel and timeline remain bounded on desktop and mobile. Normal forecasting refreshes at day rollover without disrupting an open draft or drag. A chosen date that has become past is explicitly rejected. Return to plan clears the assumption. Dragging is disabled while an assumption is displayed. There is no apply action, scenario persistence, automatic date save or resource engine.

### Verification before implementation is accepted

Test isolated synthetic plans with dependency chains, independent work, a broadly scoped blocker narrowed to specific Activities, weekend opt-in/out, and work planned after the assumed resolution. Include in-progress work using the percentage-based approximation, plus factual Started/Done and overlapping blocker history. Verify that viewing, adjusting and closing a simulation never changes saved dates, progress, issues or actual starts.

## Plan deadline

Requested on 2026-10-14 alongside the blocker-impact simulation. **Deadline** in Plan details is an explicit target date set by the operator, independent of the calculated finish of its Activities.

The deadline stays fixed when tasks move or a what-if assumption changes. The projected finish is calculated from the Activity schedule and can move; it is not an editable replacement for the deadline. Show their difference so management can distinguish remaining margin from an expected overrun. A schedule can slip without missing the deadline.

Deadline is optional, edited in Plan details and accepted by the existing scoped plan MCP commands. Omission or null means no supplied target; the UI displays Not set and no deadline comparison. Existing plans are not rewritten or assigned dates. Never derive a deadline from the last Activity or overwrite one from a simulation.

Local Started/Done timestamps and recorded issue blocking intervals are available in v0.2.1; requirement-document links and PocketHive run/journal integration remain deferred.
