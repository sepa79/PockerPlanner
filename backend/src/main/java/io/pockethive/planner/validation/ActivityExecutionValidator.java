package io.pockethive.planner.validation;

import com.fasterxml.jackson.databind.JsonNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Responsibility: validate persisted activity execution timestamps and observed blocking intervals.
 * Must not: infer missing facts, consult a clock, update intervals or require historical issues to exist.
 * Contract: docs/ARCHITECTURE.md activity execution timing; historical facts remain unchanged.
 */
final class ActivityExecutionValidator {
    private static final Set<String> INTERVAL_FIELDS = Set.of("issueId", "title", "startedAt", "endedAt");

    private ActivityExecutionValidator() {}

    static void validate(JsonNode activity) {
        Instant started = optionalTimestamp(activity, "startedAt");
        Instant completed = optionalTimestamp(activity, "completedAt");
        Instant tracking = optionalTimestamp(activity, "blockerTrackingSince");
        if (completed != null && (activity.get("progress").intValue() != 100
                || (started != null && completed.isBefore(started)))) {
            throw new InvalidWorkspace("Completion requires 100% progress and cannot precede Started");
        }
        if (tracking != null && (started == null || tracking.isBefore(started)
                || (completed != null && tracking.isAfter(completed)))) {
            throw new InvalidWorkspace("Invalid blocker tracking period");
        }
        JsonNode intervals = activity.get("blockerIntervals");
        if (intervals == null) {
            return;
        }
        if (!intervals.isArray() || intervals.size() > 1000) {
            throw new InvalidWorkspace("Invalid blocker intervals (maximum 1000)");
        }
        Map<String, Instant> lastEnds = new HashMap<>();
        for (JsonNode interval : intervals) {
            Set<String> fields = new HashSet<>();
            interval.fieldNames().forEachRemaining(fields::add);
            if (!interval.isObject() || !fields.equals(INTERVAL_FIELDS)) {
                throw new InvalidWorkspace("Invalid blocker interval fields");
            }
            String issueId = WorkspaceValues.text(interval.get("issueId"), "Blocker interval issue ID", 80, true);
            if (!issueId.equals(interval.get("issueId").textValue())) {
                throw new InvalidWorkspace("Invalid blocker interval issue ID");
            }
            WorkspaceValues.text(interval.get("title"), "Blocker interval title", 160, true);
            Instant start = WorkspaceValues.timestamp(interval.get("startedAt"), "Blocker interval start");
            Instant end = interval.get("endedAt").isNull() ? null
                    : WorkspaceValues.timestamp(interval.get("endedAt"), "Blocker interval end");
            if (tracking == null || start.isBefore(tracking) || (end != null && end.isBefore(start))
                    || (completed != null && (end == null || end.isAfter(completed)))) {
                throw new InvalidWorkspace("Invalid blocker interval chronology");
            }
            if (lastEnds.containsKey(issueId)
                    && (lastEnds.get(issueId) == null || start.isBefore(lastEnds.get(issueId)))) {
                throw new InvalidWorkspace("Overlapping intervals for the same blocker");
            }
            lastEnds.put(issueId, end);
        }
    }

    private static Instant optionalTimestamp(JsonNode activity, String field) {
        JsonNode value = activity.get(field);
        return value == null || value.isNull() ? null : WorkspaceValues.timestamp(value, "Activity " + field);
    }
}
