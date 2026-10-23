package io.pockethive.planner.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.http.ApiFailure;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * Responsibility: validate and project safe PH runtime observations and per-swarm permissions.
 * Must not: copy worker configuration, infer execution phases or grant Planner editing rights.
 * Contract: docs/POCKETHIVE_INTEGRATION.md Plan / Execution / Mixed observation boundary.
 */
final class RuntimeProjection {
    private static final Set<String> FIELDS = Set.of("id", "runId", "runtimeIntent", "workloadIntent",
            "controllerState", "workloadState", "health", "runtimeResourceState");

    private RuntimeProjection() {}

    static Map<String, ObjectNode> runtimes(JsonNode rows) {
        if (!rows.isArray()) {
            throw invalid();
        }
        Map<String, ObjectNode> result = new HashMap<>();
        for (JsonNode row : rows) {
            ObjectNode runtime = WorkspaceJson.object();
            for (String field : FIELDS) {
                runtime.put(field, text(row, field));
            }
            if (!row.path("observationStale").isBoolean()) {
                throw invalid();
            }
            runtime.put("observationStale", row.get("observationStale").booleanValue());
            optionalText(row, runtime, "observedAt");
            JsonNode active = row.get("activeOperation");
            if (active == null || active.isNull()) {
                runtime.putNull("activeOperation");
            } else {
                ObjectNode operation = WorkspaceJson.object();
                operation.put("type", text(active, "type"));
                operation.put("correlationId", text(active, "correlationId"));
                runtime.set("activeOperation", operation);
            }
            runtime.set("workers", workers(row.get("observation")));
            if (result.put(runtime.get("id").textValue(), runtime) != null) {
                throw invalid();
            }
        }
        return result;
    }

    static Map<String, JsonNode> permissions(JsonNode document) {
        if (!document.path("swarms").isArray()) {
            throw invalid();
        }
        Map<String, JsonNode> result = new HashMap<>();
        for (JsonNode item : document.get("swarms")) {
            String swarm = text(item, "swarmId");
            if (!item.path("canRun").isBoolean() || !item.path("canManage").isBoolean()
                    || result.put(swarm, item) != null) {
                throw invalid();
            }
        }
        return result;
    }

    static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        if (value == null || !value.isTextual() || value.textValue().isEmpty()) {
            throw invalid();
        }
        return value.textValue();
    }

    static ApiFailure invalid() {
        return new ApiFailure(503, "PocketHive returned invalid runtime/access data.");
    }

    private static ArrayNode workers(JsonNode observation) {
        ArrayNode projected = WorkspaceJson.array();
        if (observation == null || observation.isNull()) {
            return projected;
        }
        if (!observation.isObject()) {
            throw invalid();
        }
        JsonNode workers = observation.get("workers");
        if (workers == null) {
            return projected;
        }
        if (!workers.isArray() || workers.size() > 1000) {
            throw invalid();
        }
        for (JsonNode worker : workers) {
            ObjectNode item = WorkspaceJson.object().put("instance", text(worker, "instance"))
                    .put("role", text(worker, "role"));
            for (String field : Set.of("enabled", "stale")) {
                JsonNode value = worker.get(field);
                if (value != null && !value.isNull() && !value.isBoolean()) {
                    throw invalid();
                }
                item.set(field, value == null ? com.fasterxml.jackson.databind.node.NullNode.instance : value);
            }
            JsonNode tps = worker.get("tps");
            if (tps != null && !tps.isNull() && (!tps.isNumber() || !Double.isFinite(tps.doubleValue()))) {
                throw invalid();
            }
            item.set("tps", tps == null ? com.fasterxml.jackson.databind.node.NullNode.instance : tps);
            optionalText(worker, item, "lastSeenAt");
            projected.add(item);
        }
        return projected;
    }

    private static void optionalText(JsonNode source, ObjectNode target, String field) {
        JsonNode value = source.get(field);
        if (value != null && !value.isNull() && !value.isTextual()) {
            throw invalid();
        }
        target.set(field, value == null ? com.fasterxml.jackson.databind.node.NullNode.instance : value);
    }
}
