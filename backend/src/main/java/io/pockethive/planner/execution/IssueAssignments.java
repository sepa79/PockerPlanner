package io.pockethive.planner.execution;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import java.util.HashSet;
import java.util.Set;

/**
 * Responsibility: compose explicit Activity issue assignments within a validated plan.
 * Must not: persist state, validate the workspace or change unrelated assignments and facts.
 * Contract: docs/ARCHITECTURE.md issue scopes and atomic narrowing of ALL/STREAMS assignments.
 */
public final class IssueAssignments {
    private IssueAssignments() {}

    public static boolean affects(JsonNode issue, JsonNode activity) {
        return switch (issue.path("scope").asText()) {
            case "ALL" -> true;
            case "STREAMS" -> contains(issue.path("streamIds"), activity.path("streamId"));
            case "ACTIVITIES" -> contains(issue.path("activityIds"), activity.path("id"));
            default -> throw new InvalidWorkspace("Issue scope must be ALL, STREAMS or ACTIVITIES");
        };
    }

    public static void assign(ObjectNode plan, ObjectNode activity) {
        Set<String> desired = new HashSet<>();
        activity.path("issueIds").forEach(issueId -> desired.add(issueId.textValue()));
        for (JsonNode issueNode : plan.path("issues")) {
            ObjectNode issue = (ObjectNode) issueNode;
            boolean assigned = desired.contains(issue.path("id").textValue());
            if (affects(issue, activity) == assigned) {
                continue;
            }
            ArrayNode targets = WorkspaceJson.array();
            for (JsonNode candidate : plan.path("activities")) {
                boolean selected = candidate.path("id").equals(activity.path("id"))
                        ? assigned : affects(issue, candidate);
                if (selected) {
                    targets.add(candidate.path("id"));
                }
            }
            issue.put("scope", "ACTIVITIES");
            issue.set("streamIds", WorkspaceJson.array());
            issue.set("activityIds", targets);
        }
    }

    private static boolean contains(JsonNode values, JsonNode value) {
        for (JsonNode candidate : values) {
            if (candidate.equals(value)) {
                return true;
            }
        }
        return false;
    }
}
