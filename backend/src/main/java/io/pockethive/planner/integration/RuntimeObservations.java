package io.pockethive.planner.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.WorkspaceJson;
import java.time.Clock;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Responsibility: join exact linked runs with fresh PH runtime and access projections.
 * Must not: persist observations, substitute a newer run or infer manual progress and Started/Done.
 * Contract: docs/POCKETHIVE_INTEGRATION.md observed execution is separate from planning facts.
 */
@Component
public final class RuntimeObservations {
    private final LinkedRuns linked;
    private final PhApiClient ph;
    private final Clock clock;

    @Autowired
    public RuntimeObservations(LinkedRuns linked, PhApiClient ph) {
        this(linked, ph, Clock.systemUTC());
    }

    RuntimeObservations(LinkedRuns linked, PhApiClient ph, Clock clock) {
        this.linked = linked;
        this.ph = ph;
        this.clock = clock;
    }

    public ObjectNode read(String planId, String authorization) {
        ObjectNode references = linked.read(planId, authorization);
        Map<String, ObjectNode> runtimes = RuntimeProjection.runtimes(ph.get("/orchestrator/api/swarms", authorization));
        Map<String, JsonNode> permissions = RuntimeProjection.permissions(ph.get("/orchestrator/api/access/swarms", authorization));
        ArrayNode runs = WorkspaceJson.array();
        for (JsonNode reference : references.withArray("runs")) {
            ObjectNode run = ((ObjectNode) reference).deepCopy();
            ObjectNode runtime = runtimes.get(reference.get("swarmId").textValue());
            boolean current = runtime != null && runtime.get("runId").equals(reference.get("runId"));
            JsonNode access = permissions.get(reference.get("swarmId").textValue());
            run.set("runtime", current ? runtime.deepCopy() : com.fasterxml.jackson.databind.node.NullNode.instance);
            run.put("canStart", current && access != null && access.get("canRun").booleanValue());
            run.put("canStop", current && access != null && access.get("canManage").booleanValue());
            runs.add(run);
        }
        references.set("runs", runs);
        references.put("fetchedAt", clock.instant().toString());
        return references;
    }
}
