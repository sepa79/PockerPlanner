# Changelog

## Unreleased

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
