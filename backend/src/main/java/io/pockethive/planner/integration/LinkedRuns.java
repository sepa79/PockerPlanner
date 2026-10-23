package io.pockethive.planner.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import java.util.HashSet;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Responsibility: project PH's exact saved run associations against one current catalogue.
 * Must not: persist, substitute latest runs, control execution or infer planning facts.
 * Contract: docs/POCKETHIVE_INTEGRATION.md unresolved tags, exact journal URLs and listing cap.
 */
@Component
public final class LinkedRuns {
    private static final int RUN_LIMIT = 5000;
    private final PlannerCatalogue catalogue;
    private final PhApiClient client;
    private final String publicUrl;

    public LinkedRuns(PlannerCatalogue catalogue, PhApiClient client,
                      @Value("${POCKETHIVE_PUBLIC_URL:}") String publicUrl) {
        this.catalogue = catalogue;
        this.client = client;
        this.publicUrl = publicUrl;
    }

    public ObjectNode read(String planId, String authorization) {
        ObjectNode current = catalogue.catalogue();
        JsonNode plan = null;
        for (JsonNode candidate : current.get("plans")) {
            if (candidate.get("id").textValue().equals(planId)) {
                plan = candidate;
                break;
            }
        }
        if (plan == null) {
            throw new InvalidWorkspace("Unknown plan ID");
        }
        String base = PhUrls.base(publicUrl, "POCKETHIVE_PUBLIC_URL");
        JsonNode rows = client.get("/orchestrator/api/journal/swarm/runs?limit=5000", authorization);
        if (rows == null || !rows.isArray() || rows.size() > RUN_LIMIT) {
            throw PhJson.invalid();
        }
        ObjectNode result = PhJson.object().put("limitReached", rows.size() == RUN_LIMIT);
        result.set("revision", current.get("revision").deepCopy());
        var runs = result.putArray("runs");
        Set<String> known = new HashSet<>();
        for (JsonNode activity : plan.get("activities")) {
            known.add(activity.get("tag").textValue());
        }
        for (JsonNode row : rows) {
            if (!row.isObject()) {
                throw PhJson.invalid();
            }
            JsonNode testPlan = row.get("testPlan");
            if (testPlan != null && !testPlan.isNull() && !testPlan.isTextual()) {
                throw PhJson.invalid();
            }
            if (testPlan == null || !testPlan.equals(plan.get("testPlan"))) {
                continue;
            }
            String swarmId = requiredText(row.get("swarmId"));
            String runId = requiredText(row.get("runId"));
            JsonNode tags = row.get("tags");
            if (tags == null || !tags.isArray()) {
                throw PhJson.invalid();
            }
            Set<String> selected = new HashSet<>();
            for (JsonNode tag : tags) {
                if (!tag.isTextual()) {
                    throw PhJson.invalid();
                }
                selected.add(tag.textValue());
            }
            JsonNode scenario = row.get("scenarioId");
            if (scenario != null && !scenario.isNull() && !scenario.isTextual()) {
                throw PhJson.invalid();
            }
            ObjectNode run = runs.addObject().put("swarmId", swarmId).put("runId", runId);
            run.set("scenarioId", scenario == null ? com.fasterxml.jackson.databind.node.NullNode.instance : scenario.deepCopy());
            var activities = run.putArray("activityIds");
            for (JsonNode activity : plan.get("activities")) {
                if (selected.contains(activity.get("tag").textValue())) {
                    activities.add(activity.get("id").textValue());
                }
            }
            var unresolved = run.putArray("unresolvedActivityTags");
            for (JsonNode tag : tags) {
                if (tag.textValue().startsWith("pp.activity:") && !known.contains(tag.textValue())) {
                    unresolved.add(tag.textValue());
                }
            }
            run.put("journalUrl", base + "/journal/swarms/" + PhUrls.segment(swarmId) + "?runId=" + PhUrls.segment(runId));
        }
        return result;
    }

    private static String requiredText(JsonNode node) {
        if (node == null || !node.isTextual() || node.textValue().isEmpty()) {
            throw PhJson.invalid();
        }
        return node.textValue();
    }
}
