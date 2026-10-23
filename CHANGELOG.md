# Changelog

## Unreleased

## 0.2.3 - 2026-10-23

### Changed
- Move PocketPlanner to Java 21 / Spring Boot and React / TypeScript, using the shared PocketHive UI, browser authentication and JVM identity libraries. One JAR serves UI, REST, SSE, MCP and PH adapters; SQLite retains one authoritative writer.
- Replace the execution list with expandable Stream / Activity / run rows. Keep operator-maintained progress and Started / Done independent of PH runtime state.
- Use a collapsible left Plan / Execution / Mixed rail with contextual menus, explicit runtime history and deduplicated run summaries.
- Align the full and compact PocketPlanner logos with the Pocket family proportions.

### Added
- PocketHive integration with stable instance-scoped Plan / Stream / Activity references and exact historical run identities. Show linked runs in planning details and the Execution / Mixed views.
- A swarm panel with health, workers, reported TPS and permission-scoped Start / Stop. Preserve correlation-specific outcomes, exact-run admission and explicit uncertainty without automatic command retries.
- Shared PH device sign-in that completes in the initiating window after explicit confirmation, including a changed app port. Journal navigation obtains PH's own session and preserves the exact swarm / run without credentials in links.
- Official Java SDK Streamable HTTP MCP through the same command, store and auth owners as REST, retaining strict body limits and Host / Origin allowlists.
- Independent Java/React Docker, Compose and HiveForge packaging with one non-root replica, a read-only root filesystem and a persistent SQLite volume.

### Fixed
- Restore the 28-day calendar range and retain the Historical issue filter across tabs, view modes and plan selection.
- Select a newly created plan only after a successful save; Cancel, conflicts, rejected saves and edits to existing plans leave selection unchanged.
- Recalculate Activity timing and blocker delay immediately when issue links change in the editor. Cancel preserves canonical state and recorded blocking history.
- Restore factual lifecycle dates, resolution dates and blocker history through explicit confirmed JSON import with the existing revision-checked transaction. Ordinary edits retain their factual-change restrictions.
- Apply the shared PH client's explicit public HTTP permission to device sign-in and logout. Keep HTTPS / loopback defaults and require configured permission for remote HTTP.
- Pin and verify the exact resolved shared-auth artifacts during packaging, including builds with tests skipped.

### Security
- Update Jackson, Tomcat, Apache HttpClient / HttpCore and Log4j within the current Java platform; retain non-root execution, dropped capabilities and no-new-privileges.
- Update Vitest to 4.1.12 to address the newly reported development-tool mock-registration advisories.
- Record exact-image vulnerability results and the applicability assessment for the two known Spring MVC advisories in docs/SECURITY_REVIEW.md. No clean-scan claim or vulnerability suppression is introduced.

### Documentation
- Document the Java/React architecture, API/MCP, shared PH authentication, JSON switch-over and independent Compose / HiveForge deployment.
- Record the planned SUT / DataSet / DataProvider direction: shared Redis list circulation, producer inventory and operator clear / repopulate recovery. These design notes do not add checkout states, tracking, automated recovery or a PH runtime rebuild.
- Keep future requirement-document, Rovo and data-mix controls separate from the implemented local PH integration.

## 0.2.2 - 2026-10-15

### Changed
- Make Started and Done reversible, with editable local actual dates and Save/Cancel semantics. Undoing Done requires an explicitly entered progress below 100%; undoing Started resets progress and execution facts. Date corrections preserve observed blocking only within the corrected actual period, without inventing earlier history.

### Fixed
- Preserve the recorded occurrence when correcting repeated local times; show an earlier/later UTC-offset selector only for ambiguous manual dates, require a choice for new ambiguous dates, and use the same resolved instant for validation, preview and Save.
- Validate actual dates by their original UTC instants across repeated daylight-saving hours, without blocking unrelated edits or rewriting unchanged timestamps.
- Allow Done followed by Started before Save: automatic dates share one prospective save time instead of comparing click times, while explicit invalid date corrections remain rejected.

## 0.2.1 - 2026-10-14

### Documentation
- Record the deferred PocketHive integration design: many-to-many run/Activity associations, actual starts with optional journal evidence, requirement-document references and agent retry/ownership rules. No integration functionality is implemented.
- Document live-update, blocker-impact preview and deadline contracts and their isolated regression coverage.

### Added
- Live updates across browser sessions for committed UI/import/MCP changes, with queued draft/drag refreshes, stale-save protection and visible connection/recovery status.
- Optional plan deadline in JSON, Plan details and scoped MCP commands, independent of the calculated schedule finish.
- Read-only What if with a blocker selector, assumed end-date picker and ±1 day controls, automatic percentage-based remaining estimates, dependency/weekend propagation and deadline comparison.
- Factual Activity Started/Done timestamps and recorded blocker intervals; details distinguish estimate, projected finish, elapsed actual time and overlapping-blocker time without double counting.

### Changed
- Add −/+ buttons around the Activity duration field, retaining direct entry, validation, viewer permissions and Save/Cancel behavior.
- Show estimated calendar-day finish delay attributable to blockers alongside separately recorded elapsed blocking time, including inherited dependency delays without counting overlapping blockers twice.
- Show pauses in red, including weekends, and non-working weekends in grey; keep enabled working weekends unchanged. Names remain anchored to their task/stream frames when pause dates change.
- Show one continuous Activity/Stream frame, with colored non-working weekends and blocking/waiting periods; keep progress off these gaps.
- Apply blocker-aware forecasts to normal Plan too: open blocking lasts through today, eligible work resumes no earlier than tomorrow, dependencies follow and saved estimates remain unchanged. Retain known closed-blocker calendar delays and refresh at day rollover.
- Keep one timeline in What if: override only the selected blocker's inclusive end date, defaulting to today. Date changes update immediately without a Preview button or duplicate bars. Return to plan clears the assumption; saved changes from other sessions recalculate it.
- Anchor completed activities to known actual Started/Done dates, without inventing missing timestamps; prevent dragging recorded completion frames.
- Replace start-date confirmation with one Started / progress slider / numeric stepper / Done row, staged until Save. Actual times are never guessed from percentages or planned dates.
- Dismiss editor and sign-in dialogs by clicking their backdrop; preserve pending-save locks and explicit acknowledgement of the full-block warning.
- JSON downloads use the selected plan's filename-safe name, preserving the existing all-plan export content.
- Show the application version in the top bar from the canonical `VERSION` file, also exposed through `/api/info` and MCP initialization.
- Use a compact header logo without the subtitle; retain the full `simple test plan` logo for README and documentation.

### Fixed
- Keep collapsed Stream progress based on the union of available work days after recorded Done; exclude non-working weekends, pauses and idle gaps, and count overlapping work only once.
- Forecast remaining work from a recorded Started date rather than a later authored start, while retaining actual Activity/Stream dependency constraints and full-estimate dates.
- Preserve available parallel work and progress in collapsed Streams; one member's pause no longer hides another member's working days, including working weekends and recorded completed spans.
- Reject invalid Activity progress types/ranges through the shared store validator before lifecycle comparisons, returning HTTP 400 instead of 500 without changing saved state.

## 0.2.0 - 2026-10-14

### Added
- Activity and stream finish-to-start dependencies with cascading schedules, weekend handling and invalid-reference/cycle rejection.
- Nested timeline indentation and confirmation invalidation after upstream date changes.
- Activity-scoped issues with atomic assignment changes through the activity editor and MCP.

### Fixed
- Unlinking an activity updates its issue's actual scope without unblocking unrelated activities.
- The full-block warning appears only when every unfinished activity is blocked.
