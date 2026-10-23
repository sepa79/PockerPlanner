package io.pockethive.planner.execution;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.Map;

/**
 * Responsibility: compose recorded issue resolution dates in a private transaction draft.
 * Must not: read a clock, persist state or infer historical resolution events for imported issues.
 * Contract: docs/ARCHITECTURE.md close stamps once, reopening clears, recorded facts remain unchanged.
 */
public final class IssueResolutions {
    private IssueResolutions() {}

    public static void record(ObjectNode document, ObjectNode current, Instant now) {
        Map<String, Map<String, JsonNode>> previous = new HashMap<>();
        for (JsonNode plan : current.path("plans")) {
            Map<String, JsonNode> issues = new HashMap<>();
            for (JsonNode issue : plan.path("issues")) {
                issues.put(issue.path("id").textValue(), issue);
            }
            previous.put(plan.path("id").textValue(), issues);
        }
        String timestamp = now.truncatedTo(ChronoUnit.SECONDS).toString();
        for (JsonNode plan : document.path("plans")) {
            Map<String, JsonNode> previousIssues = previous.getOrDefault(plan.path("id").textValue(), Map.of());
            for (JsonNode issueNode : plan.path("issues")) {
                ObjectNode issue = (ObjectNode) issueNode;
                JsonNode old = previousIssues.get(issue.path("id").textValue());
                if (issue.path("open").booleanValue()) {
                    issue.remove("resolvedAt");
                } else if (old != null && old.path("open").booleanValue()) {
                    issue.put("resolvedAt", timestamp);
                } else if (old != null && old.hasNonNull("resolvedAt")) {
                    issue.set("resolvedAt", old.get("resolvedAt"));
                }
            }
        }
    }
}
