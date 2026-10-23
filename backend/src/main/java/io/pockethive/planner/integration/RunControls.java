package io.pockethive.planner.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.http.ApiFailure;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Responsibility: delegate explicit Start/Stop and exact correlation outcome reads to PH.
 * Must not: create swarms, retry commands, decide PH permissions or change Planner facts.
 * Contract: docs/POCKETHIVE_INTEGRATION.md exact linked run admission and uncertain outcomes.
 */
@Component
public final class RunControls {
    private static final Set<String> REQUIRED = Set.of("planId", "swarmId", "runId", "action", "idempotencyKey");
    private final LinkedRuns linked;
    private final PhApiClient ph;

    public RunControls(LinkedRuns linked, PhApiClient ph) {
        this.linked = linked;
        this.ph = ph;
    }

    public JsonNode control(ObjectNode request, String authorization) {
        if (request == null || request.size() != REQUIRED.size()) {
            throw new InvalidWorkspace("Supply planId, swarmId, runId, action and idempotencyKey");
        }
        for (String field : REQUIRED) {
            if (!request.path(field).isTextual() || request.get(field).textValue().isEmpty()) {
                throw new InvalidWorkspace("Control fields must be nonempty strings");
            }
        }
        String action = request.get("action").textValue();
        String key = request.get("idempotencyKey").textValue();
        if (!Set.of("start", "stop").contains(action) || !key.matches("[A-Za-z0-9_-]{1,100}")) {
            throw new InvalidWorkspace("Supply action start/stop and a valid idempotencyKey");
        }
        String swarmId = request.get("swarmId").textValue();
        String runId = request.get("runId").textValue();
        String path = runPath(swarmId, runId);
        requireLinked(request.get("planId").textValue(), swarmId, runId, authorization);
        JsonNode result = ph.post(path + "/" + action, authorization, WorkspaceJson.object().put("idempotencyKey", key));
        JsonNode timeout = result.get("timeoutMs");
        if (!result.isObject() || !result.path("correlationId").isTextual() || result.get("correlationId").textValue().isEmpty()
                || !result.path("idempotencyKey").isTextual() || !key.equals(result.get("idempotencyKey").textValue())
                || timeout == null || !timeout.isIntegralNumber() || !timeout.canConvertToInt()
                || timeout.intValue() < 1 || timeout.intValue() > 180_000) {
            throw new ApiFailure(503, "Invalid PH acknowledgement; command outcome is unknown. No automatic retry.");
        }
        return result;
    }

    public JsonNode operation(String planId, String swarmId, String runId, String correlationId, String authorization) {
        String path = runPath(swarmId, runId) + "/operations/" + segment(correlationId);
        requireLinked(planId, swarmId, runId, authorization);
        JsonNode result = ph.get(path, authorization);
        if (!result.isObject() || !result.path("swarmId").isTextual() || !swarmId.equals(result.get("swarmId").textValue())
                || !result.path("correlationId").isTextual() || !correlationId.equals(result.get("correlationId").textValue())
                || !result.path("runtime").isObject() || !result.path("runtime").path("runId").isTextual()
                || !runId.equals(result.get("runtime").get("runId").textValue())) {
            throw new ApiFailure(409, "PocketHive operation identity does not match the selected run.");
        }
        return result;
    }

    private void requireLinked(String planId, String swarmId, String runId, String authorization) {
        ObjectNode references = linked.read(planId, authorization);
        for (JsonNode run : references.withArray("runs")) {
            if (swarmId.equals(run.path("swarmId").textValue()) && runId.equals(run.path("runId").textValue())) {
                return;
            }
        }
        throw new ApiFailure(404, "This exact run is not linked to the selected plan.");
    }

    private static String runPath(String swarmId, String runId) {
        return "/orchestrator/api/swarms/" + segment(swarmId) + "/runs/" + segment(runId);
    }

    private static String segment(String value) {
        if (value == null || value.isEmpty() || value.codePointCount(0, value.length()) > 200
                || value.equals(".") || value.equals("..") || value.codePoints().anyMatch(character -> character < 32)) {
            throw new InvalidWorkspace("Invalid swarm/run/operation identity");
        }
        return PhUrls.segment(value);
    }
}
