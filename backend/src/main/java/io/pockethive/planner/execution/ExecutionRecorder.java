package io.pockethive.planner.execution;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.ActivityKey;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.validation.WorkspaceValues;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Responsibility: compose factual Activity lifecycle actions and observed blocker intervals.
 * Must not: persist state, read a clock, infer starts or calculate forecasts.
 * Contract: docs/ARCHITECTURE.md Activity execution timing; mutate only the store's private draft.
 */
public final class ExecutionRecorder {
    private static final List<String> RECORDED_FIELDS = List.of(
            "startedAt", "completedAt", "blockerTrackingSince", "blockerIntervals");

    private ExecutionRecorder() {}

    public static void record(ObjectNode document, ObjectNode current, Map<ActivityKey, ObjectNode> actions, Instant now) {
        Map<ActivityKey, JsonNode> previous = new HashMap<>();
        for (JsonNode plan : current.path("plans")) {
            for (JsonNode activity : plan.path("activities")) {
                previous.put(new ActivityKey(plan.path("id").textValue(), activity.path("id").textValue()), activity);
            }
        }
        String timestamp = now.truncatedTo(ChronoUnit.SECONDS).toString();
        for (JsonNode plan : document.path("plans")) {
            for (JsonNode activityNode : plan.path("activities")) {
                ObjectNode activity = (ObjectNode) activityNode;
                ActivityKey key = new ActivityKey(plan.path("id").textValue(), activity.path("id").textValue());
                JsonNode old = previous.get(key);
                if (old != null) {
                    restoreRecordedFields(activity, old);
                }
                applyActions(activity, old, actions.getOrDefault(key, WorkspaceJson.object()), timestamp, now);
                if (activity.hasNonNull("startedAt")) {
                    trackBlockers(plan, activity, timestamp);
                }
            }
        }
    }

    private static void restoreRecordedFields(ObjectNode activity, JsonNode old) {
        for (String field : RECORDED_FIELDS) {
            JsonNode proposed = activity.get(field);
            JsonNode recorded = old.get(field);
            if (proposed != null && !(proposed.isNull() && recorded == null) && !proposed.equals(recorded)) {
                throw new InvalidWorkspace(field + " is server-owned; use Started/Done actions");
            }
            if (recorded != null) {
                activity.set(field, recorded.deepCopy());
            }
        }
    }

    private static void applyActions(ObjectNode activity, JsonNode old, ObjectNode action, String timestamp, Instant now) {
        for (String field : List.of("started", "done")) {
            if (action.has(field) && !action.get(field).isBoolean()) {
                throw new InvalidWorkspace("Started and Done actions must be booleans");
            }
        }
        if (action.has("started") && !action.get("started").booleanValue()) {
            if (action.path("done").booleanValue() || action.has("startedAt") || action.has("completedAt")) {
                throw new InvalidWorkspace("Not started cannot include actual dates or Done");
            }
            activity.put("progress", 0);
            RECORDED_FIELDS.forEach(activity::remove);
            return;
        }
        for (String field : List.of("startedAt", "completedAt")) {
            if (action.has(field) && WorkspaceValues.timestamp(action.get(field), "Activity " + field).isAfter(now)) {
                throw new InvalidWorkspace("Actual dates cannot be in the future");
            }
        }
        if (action.has("done") && !action.get("done").booleanValue()) {
            if (activity.path("progress").intValue() == 100 || action.has("completedAt")) {
                throw new InvalidWorkspace("Choose progress below 100% when undoing Done");
            }
            activity.remove("completedAt");
        }
        if (action.has("startedAt")) {
            activity.set("startedAt", action.get("startedAt"));
        } else if (action.path("started").booleanValue() && !activity.hasNonNull("startedAt")) {
            activity.put("startedAt", timestamp);
        }
        if (action.path("done").booleanValue()
                || (old != null && old.path("progress").intValue() < 100 && activity.path("progress").intValue() == 100)) {
            if (activity.path("progress").intValue() != 100) {
                throw new InvalidWorkspace("Done requires 100% progress");
            }
            if (!activity.hasNonNull("completedAt")) {
                activity.put("completedAt", timestamp);
            }
        }
        if (action.has("completedAt")) {
            activity.set("completedAt", action.get("completedAt"));
        }
        if (activity.path("progress").intValue() < 100) {
            if (action.has("completedAt")) {
                throw new InvalidWorkspace("Completion requires 100% progress");
            }
            activity.remove("completedAt");
        }
        if (action.has("startedAt") || action.has("completedAt")) {
            clipBlockers(activity);
        }
    }

    private static void clipBlockers(ObjectNode activity) {
        if (!activity.hasNonNull("startedAt") || !activity.hasNonNull("blockerTrackingSince")) {
            return;
        }
        Instant started = WorkspaceValues.timestamp(activity.get("startedAt"), "Activity startedAt");
        Instant completed = activity.hasNonNull("completedAt")
                ? WorkspaceValues.timestamp(activity.get("completedAt"), "Activity completedAt") : null;
        Instant tracking = WorkspaceValues.timestamp(activity.get("blockerTrackingSince"), "Activity blockerTrackingSince");
        if (completed != null && tracking.isAfter(completed)) {
            activity.remove(List.of("blockerTrackingSince", "blockerIntervals"));
            return;
        }
        if (tracking.isBefore(started)) {
            activity.set("blockerTrackingSince", activity.get("startedAt"));
        }
        ArrayNode clipped = WorkspaceJson.array();
        for (JsonNode intervalNode : activity.path("blockerIntervals")) {
            ObjectNode interval = (ObjectNode) intervalNode;
            Instant start = WorkspaceValues.timestamp(interval.get("startedAt"), "Blocker interval start");
            Instant end = interval.hasNonNull("endedAt")
                    ? WorkspaceValues.timestamp(interval.get("endedAt"), "Blocker interval end") : null;
            if ((end != null && !end.isAfter(started)) || (completed != null && !start.isBefore(completed))) {
                continue;
            }
            if (start.isBefore(started)) {
                interval.set("startedAt", activity.get("startedAt"));
            }
            if (completed != null && (end == null || end.isAfter(completed))) {
                interval.set("endedAt", activity.get("completedAt"));
            }
            clipped.add(interval);
        }
        if (!clipped.isEmpty() || activity.has("blockerIntervals")) {
            activity.set("blockerIntervals", clipped);
        }
    }

    private static void trackBlockers(JsonNode plan, ObjectNode activity, String timestamp) {
        boolean unfinished = activity.path("progress").intValue() < 100;
        if (!activity.hasNonNull("blockerTrackingSince") && unfinished) {
            activity.put("blockerTrackingSince", timestamp);
        }
        Map<String, JsonNode> active = new LinkedHashMap<>();
        if (unfinished) {
            for (JsonNode issue : plan.path("issues")) {
                if (issue.path("open").booleanValue() && issue.path("blocker").booleanValue()
                        && IssueAssignments.affects(issue, activity)) {
                    active.put(issue.path("id").textValue(), issue);
                }
            }
        }
        ArrayNode intervals = activity.has("blockerIntervals")
                ? (ArrayNode) activity.get("blockerIntervals") : WorkspaceJson.array();
        for (JsonNode intervalNode : intervals) {
            ObjectNode interval = (ObjectNode) intervalNode;
            String issueId = interval.path("issueId").textValue();
            if (!interval.hasNonNull("endedAt")) {
                if (active.containsKey(issueId)) {
                    active.remove(issueId);
                } else {
                    interval.put("endedAt", timestamp);
                }
            }
        }
        for (Map.Entry<String, JsonNode> entry : active.entrySet()) {
            ObjectNode interval = WorkspaceJson.object();
            interval.put("issueId", entry.getKey());
            interval.set("title", entry.getValue().get("title"));
            interval.put("startedAt", timestamp);
            interval.putNull("endedAt");
            intervals.add(interval);
        }
        if (!intervals.isEmpty() || activity.has("blockerIntervals")) {
            activity.set("blockerIntervals", intervals);
        }
    }
}
