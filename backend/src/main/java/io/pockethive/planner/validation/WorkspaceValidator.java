package io.pockethive.planner.validation;

import com.fasterxml.jackson.databind.JsonNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.domain.WorkspaceLimits;
import java.math.BigInteger;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Responsibility: validate the current workspace tree, collection limits and plan-local references.
 * Must not: normalize fields, configure JSON, persist state, infer lifecycle facts or calculate schedules.
 * Contract: docs/ARCHITECTURE.md data contract; validation preserves absent, null and supported extra fields.
 */
public final class WorkspaceValidator {
    private static final Set<String> WORKSPACE_FIELDS = Set.of("schemaVersion", "revision", "plans");
    private static final Set<String> PLAN_REQUIRED = Set.of(
            "id", "name", "description", "streams", "activityTypes", "activities", "issues");
    private static final Set<String> PLAN_ALLOWED = Set.of(
            "id", "name", "description", "streams", "activityTypes", "activities", "issues", "deadline");
    private static final Set<String> STREAM_REQUIRED = Set.of("id", "name", "description");
    private static final Set<String> STREAM_ALLOWED = Set.of("id", "name", "description", "dependsOn");
    private static final Pattern COLOR = Pattern.compile("#[0-9a-fA-F]{6}");

    public void validate(JsonNode document) {
        fields(document, WORKSPACE_FIELDS, WORKSPACE_FIELDS,
                "Invalid workspace. Expected schemaVersion, revision and plans.");
        JsonNode schema = document.get("schemaVersion");
        if (!schema.isIntegralNumber()
                || !schema.bigIntegerValue().equals(BigInteger.valueOf(WorkspaceLimits.SCHEMA_VERSION))) {
            throw new InvalidWorkspace("Unsupported workspace schema version");
        }
        JsonNode revision = document.get("revision");
        if (!revision.isIntegralNumber() || revision.bigIntegerValue().signum() < 0) {
            throw new InvalidWorkspace("Invalid revision");
        }
        for (JsonNode plan : items(document, "plans", 100).values()) {
            validatePlan(plan);
        }
        WorkspaceJson.encode(document);
    }

    private static void validatePlan(JsonNode plan) {
        fields(plan, PLAN_REQUIRED, PLAN_ALLOWED, "Invalid plan fields");
        WorkspaceValues.text(plan.get("name"), "plan name", 160, true);
        WorkspaceValues.text(plan.get("description"), "plan description", 12000, false);
        if (plan.hasNonNull("deadline")) {
            WorkspaceValues.calendarDate(plan.get("deadline"), "Plan deadline");
        }
        Map<String, JsonNode> streams = items(plan, "streams", 500);
        Map<String, JsonNode> types = items(plan, "activityTypes", 500);
        Map<String, JsonNode> activities = items(plan, "activities", 500);
        Map<String, JsonNode> issues = items(plan, "issues", 500);
        for (JsonNode stream : streams.values()) {
            fields(stream, STREAM_REQUIRED, STREAM_ALLOWED, "Invalid stream fields");
            WorkspaceValues.text(stream.get("name"), "stream name", 100, true);
            WorkspaceValues.text(stream.get("description"), "stream description", 2000, false);
        }
        for (JsonNode type : types.values()) {
            WorkspaceValues.text(type.get("name"), "activity type", 80, true);
            JsonNode color = type.get("color");
            if (color == null || !color.isTextual() || !COLOR.matcher(color.textValue()).matches()) {
                throw new InvalidWorkspace("Invalid activity type color");
            }
        }
        for (JsonNode issue : issues.values()) {
            validateIssue(issue, streams.keySet(), activities.keySet());
        }
        Set<String> populatedStreams = new HashSet<>();
        for (JsonNode activity : activities.values()) {
            validateActivity(activity, streams.keySet(), types.keySet(), issues.keySet());
            populatedStreams.add(activity.get("streamId").textValue());
        }
        WorkspaceDependencies.validate(streams, "stream", false);
        WorkspaceDependencies.validate(activities, "activity", true);
        for (JsonNode stream : streams.values()) {
            if (stream.hasNonNull("dependsOn") && !populatedStreams.contains(stream.get("dependsOn").textValue())) {
                throw new InvalidWorkspace("A predecessor stream must contain at least one activity");
            }
        }
    }

    private static void validateIssue(JsonNode issue, Set<String> streamIds, Set<String> activityIds) {
        WorkspaceValues.text(issue.get("title"), "issue title", 160, true);
        WorkspaceValues.text(issue.get("description"), "issue description", 2000, false);
        JsonNode scopeValue = issue.get("scope");
        if (scopeValue == null || !scopeValue.isTextual()
                || !Set.of("ALL", "STREAMS", "ACTIVITIES").contains(scopeValue.textValue())) {
            throw new InvalidWorkspace("Issue scope must be ALL, STREAMS or ACTIVITIES");
        }
        String scope = scopeValue.textValue();
        JsonNode targets = issue.get("streamIds");
        references(targets, streamIds, "Issue refers to an invalid stream");
        if ((!scope.equals("STREAMS") && !targets.isEmpty()) || (scope.equals("STREAMS") && targets.isEmpty())) {
            throw new InvalidWorkspace("Select ALL or at least one affected stream");
        }
        JsonNode selected = issue.get("activityIds");
        if (selected != null) {
            references(selected, activityIds, "Issue refers to an invalid activity");
        }
        if ((scope.equals("ACTIVITIES") && selected == null)
                || (!scope.equals("ACTIVITIES") && selected != null && !selected.isEmpty())) {
            throw new InvalidWorkspace("Select activities only for ACTIVITIES scope");
        }
        WorkspaceValues.jiraUrl(issue.get("jiraUrl"), "issue Jira URL");
        if (!booleanField(issue, "open") || !booleanField(issue, "blocker")
                || !booleanField(issue, "descriptionIncomplete")) {
            throw new InvalidWorkspace("Invalid issue flags");
        }
        if (issue.hasNonNull("resolvedAt")) {
            WorkspaceValues.timestamp(issue.get("resolvedAt"), "Issue resolvedAt");
        }
        WorkspaceValues.calendarDate(issue.get("discovered"), "Issue discovery date");
    }

    private static void validateActivity(JsonNode activity, Set<String> streamIds, Set<String> typeIds,
            Set<String> issueIds) {
        if (activity.has("started") || activity.has("done")) {
            throw new InvalidWorkspace("Started/Done are activity command actions, not workspace fields");
        }
        WorkspaceValues.text(activity.get("name"), "activity name", 160, true);
        WorkspaceValues.text(activity.get("status"), "activity status", 1000, false);
        WorkspaceValues.jiraUrl(activity.get("jiraUrl"), "activity Jira URL");
        if (!reference(activity.get("streamId"), streamIds) || !reference(activity.get("typeId"), typeIds)) {
            throw new InvalidWorkspace("Activity refers to a missing stream or type in its plan");
        }
        WorkspaceValues.calendarDate(activity.get("start"), "Activity start date");
        JsonNode duration = activity.get("durationDays");
        if (duration == null || !duration.isIntegralNumber() || !duration.canConvertToInt()
                || duration.intValue() < 1 || duration.intValue() > 365) {
            throw new InvalidWorkspace("Duration must be 1–365 full planned days");
        }
        if (activity.has("includeWeekends") && !booleanField(activity, "includeWeekends")) {
            throw new InvalidWorkspace("includeWeekends must be a boolean");
        }
        WorkspaceValues.progress(activity.get("progress"));
        ActivityExecutionValidator.validate(activity);
        references(activity.get("issueIds"), issueIds, "Activity refers to an invalid issue in its plan");
    }

    private static Map<String, JsonNode> items(JsonNode document, String collection, int maximum) {
        JsonNode values = document.get(collection);
        if (values == null || !values.isArray() || values.size() > maximum) {
            throw new InvalidWorkspace("Invalid " + collection);
        }
        Map<String, JsonNode> indexed = new LinkedHashMap<>();
        for (JsonNode item : values) {
            if (!item.isObject()) {
                throw new InvalidWorkspace("Invalid " + collection + " item");
            }
            String itemId = WorkspaceValues.text(item.get("id"), collection + " ID", 80, true);
            if (!itemId.equals(item.get("id").textValue())) {
                throw new InvalidWorkspace(collection + " ID must not contain leading or trailing whitespace");
            }
            if (indexed.putIfAbsent(itemId, item) != null) {
                throw new InvalidWorkspace("Duplicate " + collection + " ID: " + itemId);
            }
        }
        return indexed;
    }

    private static void references(JsonNode targets, Set<String> accepted, String message) {
        if (targets == null || !targets.isArray()) {
            throw new InvalidWorkspace(message);
        }
        Set<String> seen = new HashSet<>();
        for (JsonNode target : targets) {
            if (!reference(target, accepted) || !seen.add(target.textValue())) {
                throw new InvalidWorkspace(message);
            }
        }
    }

    private static boolean reference(JsonNode value, Set<String> accepted) {
        return value != null && value.isTextual() && accepted.contains(value.textValue());
    }

    private static boolean booleanField(JsonNode item, String field) {
        return item.has(field) && item.get(field).isBoolean();
    }

    private static void fields(JsonNode item, Set<String> required, Set<String> allowed, String message) {
        if (item == null || !item.isObject()) {
            throw new InvalidWorkspace(message);
        }
        Set<String> actual = new HashSet<>();
        item.fieldNames().forEachRemaining(actual::add);
        if (!actual.containsAll(required) || !allowed.containsAll(actual)) {
            throw new InvalidWorkspace(message);
        }
    }
}
