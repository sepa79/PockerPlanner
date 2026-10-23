package io.pockethive.planner.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.persistence.WorkspaceStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Responsibility: project the integration catalogue from one canonical store snapshot.
 * Must not: persist, authorize, cache workspace state or infer execution progress.
 * Contract: docs/POCKETHIVE_INTEGRATION.md schemaVersion 1 stable read-only catalogue.
 */
@Component
public final class PlannerCatalogue {
    private final WorkspaceStore store;
    private final String instanceId;

    public PlannerCatalogue(WorkspaceStore store, @Value("${POCKETPLANNER_INSTANCE_ID:}") String instanceId) {
        this.store = store;
        this.instanceId = instanceId;
    }

    public ObjectNode catalogue() {
        String instance = PlannerReferences.instance(instanceId);
        ObjectNode document = store.read();
        ObjectNode result = PhJson.object().put("schemaVersion", 1).put("instanceId", instance);
        result.set("revision", document.get("revision").deepCopy());
        var plans = result.putArray("plans");
        for (JsonNode source : document.get("plans")) {
            String planId = source.get("id").textValue();
            ObjectNode plan = plans.addObject().put("id", planId).put("name", source.get("name").textValue())
                .put("testPlan", PlannerReferences.testPlan(instance, planId));
            var streams = plan.putArray("streams");
            for (JsonNode stream : source.get("streams")) {
                streams.addObject().put("id", stream.get("id").textValue()).put("name", stream.get("name").textValue());
            }
            var activities = plan.putArray("activities");
            for (JsonNode activity : source.get("activities")) {
                String activityId = activity.get("id").textValue();
                activities.addObject().put("id", activityId).put("name", activity.get("name").textValue())
                    .put("streamId", activity.get("streamId").textValue())
                    .put("tag", PlannerReferences.tag(instance, planId, activityId));
            }
        }
        return result;
    }
}
