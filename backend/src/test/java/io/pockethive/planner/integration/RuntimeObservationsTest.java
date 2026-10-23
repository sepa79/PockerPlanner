package io.pockethive.planner.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.http.ApiFailure;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class RuntimeObservationsTest {
    private final LinkedRuns linked = mock(LinkedRuns.class);
    private final PhApiClient ph = mock(PhApiClient.class);
    private final RuntimeObservations observations = new RuntimeObservations(linked, ph,
            Clock.fixed(Instant.parse("2026-10-19T12:00:00Z"), ZoneOffset.UTC));

    @BeforeEach
    void setup() {
        when(linked.read("plan", "Bearer operator")).thenAnswer(invocation -> references());
        when(ph.get("/orchestrator/api/swarms", "Bearer operator")).thenReturn(WorkspaceJson.array().add(runtime()));
        when(ph.get("/orchestrator/api/access/swarms", "Bearer operator")).thenReturn(permissions());
    }

    @Test
    void joinsOnlyExactRunsWithSafeWorkersAndNoPhaseInference() {
        ObjectNode result = observations.read("plan", "Bearer operator");
        JsonNode run = result.at("/runs/0");
        assertEquals(references().at("/runs/0/activityIds"), run.get("activityIds"));
        assertEquals(4, run.at("/runtime/workers/0/tps").intValue());
        assertTrue(run.get("canStart").booleanValue());
        assertFalse(run.get("canStop").booleanValue());
        assertFalse(result.toString().contains("password"));
        assertFalse(result.toString().contains("progress"));
        assertFalse(result.toString().contains("startedAt"));
        assertEquals("2026-10-19T12:00:00Z", result.get("fetchedAt").textValue());
        assertEquals(7, result.get("revision").intValue());
    }

    @Test
    void historicalRunNeverBorrowsReplacementRuntimeOrPermissions() {
        when(ph.get("/orchestrator/api/swarms", "Bearer operator"))
                .thenReturn(WorkspaceJson.array().add(runtime().put("runId", "replacement")));
        JsonNode result = observations.read("plan", "Bearer operator").at("/runs/0");
        assertTrue(result.get("runtime").isNull());
        assertFalse(result.get("canStart").booleanValue());
        assertFalse(result.get("canStop").booleanValue());
    }

    @Test
    void absentRuntimeOrPermissionsNeverGrantsControls() {
        when(ph.get("/orchestrator/api/access/swarms", "Bearer operator"))
                .thenReturn(WorkspaceJson.object().set("swarms", WorkspaceJson.array()));
        assertFalse(observations.read("plan", "Bearer operator").at("/runs/0/canStart").booleanValue());
        when(ph.get("/orchestrator/api/swarms", "Bearer operator")).thenReturn(WorkspaceJson.array());
        assertTrue(observations.read("plan", "Bearer operator").at("/runs/0/runtime").isNull());
    }

    @Test
    void unknownWorkerValuesAndStaleObservationsRemainExplicit() {
        ObjectNode row = runtime().put("observationStale", true);
        ObjectNode worker = (ObjectNode) row.at("/observation/workers/0");
        worker.remove(List.of("enabled", "tps", "stale", "lastSeenAt"));
        when(ph.get("/orchestrator/api/swarms", "Bearer operator")).thenReturn(WorkspaceJson.array().add(row));
        JsonNode projected = observations.read("plan", "Bearer operator").at("/runs/0/runtime");
        assertTrue(projected.get("observationStale").booleanValue());
        assertTrue(projected.at("/workers/0/tps").isNull());
        assertTrue(projected.at("/workers/0/enabled").isNull());
    }

    @Test
    void activeOperationOnlyProjectsItsPublicIdentity() {
        ObjectNode row = runtime();
        row.set("activeOperation", WorkspaceJson.object().put("type", "START").put("correlationId", "op")
                .put("privateDiagnostic", "password"));
        when(ph.get("/orchestrator/api/swarms", "Bearer operator")).thenReturn(WorkspaceJson.array().add(row));
        JsonNode projected = observations.read("plan", "Bearer operator").at("/runs/0/runtime/activeOperation");
        assertEquals(2, projected.size());
        assertEquals("op", projected.get("correlationId").textValue());
    }

    @Test
    void invalidRuntimeShapesAndTypesFailExplicitly() {
        List<Consumer<ObjectNode>> mutations = List.of(
                row -> row.remove("runId"), row -> row.put("health", 5),
                row -> row.put("observationStale", "false"), row -> row.put("observedAt", false),
                row -> row.put("observation", "invalid"),
                row -> row.set("activeOperation", WorkspaceJson.array()),
                row -> ((ObjectNode) row.at("/observation")).putNull("workers"),
                row -> ((ObjectNode) row.at("/observation/workers/0")).put("tps", "4"),
                row -> ((ObjectNode) row.at("/observation/workers/0")).put("enabled", "true"),
                row -> ((ObjectNode) row.at("/observation/workers/0")).put("lastSeenAt", 1),
                row -> ((ObjectNode) row.at("/observation/workers/0")).put("tps", Double.NaN));
        for (Consumer<ObjectNode> mutate : mutations) {
            ObjectNode row = runtime();
            mutate.accept(row);
            when(ph.get("/orchestrator/api/swarms", "Bearer operator")).thenReturn(WorkspaceJson.array().add(row));
            assertEquals(503, assertThrows(ApiFailure.class, () -> observations.read("plan", "Bearer operator")).status());
        }
        when(ph.get("/orchestrator/api/swarms", "Bearer operator")).thenReturn(WorkspaceJson.array().add(runtime()).add(runtime()));
        assertThrows(ApiFailure.class, () -> observations.read("plan", "Bearer operator"));
    }

    @Test
    void invalidPermissionsAndDuplicateSwarmPermissionsFailInsteadOfMergingGrants() {
        for (JsonNode invalid : List.of(WorkspaceJson.array(), WorkspaceJson.object(),
                WorkspaceJson.object().set("swarms", WorkspaceJson.array().add(WorkspaceJson.object().put("swarmId", "qa")
                        .put("canRun", "true").put("canManage", true))),
                WorkspaceJson.object().set("swarms", WorkspaceJson.array()
                        .add(permissions().at("/swarms/0")).add(permissions().at("/swarms/0"))))) {
            when(ph.get("/orchestrator/api/access/swarms", "Bearer operator")).thenReturn(invalid);
            assertEquals(503, assertThrows(ApiFailure.class, () -> observations.read("plan", "Bearer operator")).status());
        }
    }

    static ObjectNode references() {
        ObjectNode run = WorkspaceJson.object().put("swarmId", "qa").put("runId", "run-1");
        run.set("activityIds", WorkspaceJson.array().add("minimal").add("heavy"));
        return WorkspaceJson.object().put("revision", 7).put("limitReached", false).set("runs", WorkspaceJson.array().add(run));
    }

    static ObjectNode runtime() {
        ObjectNode row = WorkspaceJson.object().put("id", "qa").put("runId", "run-1")
                .put("runtimeIntent", "PRESENT").put("workloadIntent", "RUNNING").put("controllerState", "READY")
                .put("workloadState", "RUNNING").put("health", "HEALTHY").put("runtimeResourceState", "PRESENT")
                .put("observedAt", "2026-10-19T11:59:59Z").put("observationStale", false).putNull("activeOperation");
        ObjectNode worker = WorkspaceJson.object().put("instance", "worker").put("role", "generator")
                .put("enabled", true).put("tps", 4).put("stale", false).put("lastSeenAt", "2026-10-19T11:59:59Z");
        worker.set("config", WorkspaceJson.object().put("password", "private"));
        row.set("observation", WorkspaceJson.object().set("workers", WorkspaceJson.array().add(worker)));
        return row;
    }

    private static ObjectNode permissions() {
        return WorkspaceJson.object().set("swarms", WorkspaceJson.array().add(WorkspaceJson.object().put("swarmId", "qa")
                .put("canRun", true).put("canManage", false)));
    }
}
