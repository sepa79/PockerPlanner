package io.pockethive.planner.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.http.ApiFailure;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

class RunControlsTest {
    private final LinkedRuns linked = mock(LinkedRuns.class);
    private final PhApiClient ph = mock(PhApiClient.class);
    private final RunControls controls = new RunControls(linked, ph);

    @BeforeEach
    void setup() {
        when(linked.read("plan", "Bearer operator")).thenAnswer(invocation -> RuntimeObservationsTest.references());
        when(ph.post(anyString(), anyString(), any())).thenAnswer(invocation -> acknowledgement());
    }

    @ParameterizedTest
    @ValueSource(strings = {"start", "stop"})
    void commandsDelegateOnceWithTheExactRunSameKeyAndSession(String action) {
        assertEquals(acknowledgement(), controls.control(request().put("action", action), "Bearer operator"));
        verify(ph).post("/orchestrator/api/swarms/qa/runs/run-1/" + action, "Bearer operator",
                WorkspaceJson.object().put("idempotencyKey", "same-key"));
    }

    @Test
    void anotherRunIsRejectedBeforeCommandAdmission() {
        ApiFailure failure = assertThrows(ApiFailure.class,
                () -> controls.control(request().put("runId", "replacement"), "Bearer operator"));
        assertEquals(404, failure.status());
        verify(ph, never()).post(anyString(), anyString(), any());
    }

    @Test
    void invalidFieldsNeverReachPhCommands() {
        List<Consumer<ObjectNode>> mutations = List.of(row -> row.remove("planId"), row -> row.put("planId", 4),
                row -> row.put("action", "remove"), row -> row.put("idempotencyKey", ""),
                row -> row.put("url", "https://elsewhere.invalid"), row -> row.put("swarmId", ".."));
        for (Consumer<ObjectNode> mutate : mutations) {
            ObjectNode row = request();
            mutate.accept(row);
            assertThrows(InvalidWorkspace.class, () -> controls.control(row, "Bearer operator"));
        }
        verify(ph, never()).post(anyString(), anyString(), any());
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", ".", "..", "bad\nidentity"})
    void operationSegmentsFailExplicitlyBeforeOutboundRequests(String segment) {
        assertThrows(InvalidWorkspace.class, () -> controls.operation("plan", "qa", "run-1", segment, "Bearer operator"));
        verify(ph, never()).get(anyString(), anyString());
    }

    @Test
    void uncertainAcknowledgementIsNotRetriedOrCalledSuccess() {
        for (JsonNode invalid : List.of(WorkspaceJson.array(), WorkspaceJson.object(),
                acknowledgement().put("idempotencyKey", "other"), acknowledgement().put("timeoutMs", "1000"),
                acknowledgement().put("timeoutMs", 180001))) {
            when(ph.post(anyString(), anyString(), any())).thenReturn(invalid);
            ApiFailure failure = assertThrows(ApiFailure.class, () -> controls.control(request(), "Bearer operator"));
            assertEquals(503, failure.status());
        }
        verify(ph, org.mockito.Mockito.times(5)).post(anyString(), anyString(), any());
    }

    @Test
    void phPermissionFailureIsAuthoritativeAndNotRetried() {
        when(ph.post(anyString(), anyString(), any())).thenThrow(new ApiFailure(403, "Denied by PH"));
        assertEquals(403, assertThrows(ApiFailure.class, () -> controls.control(request(), "Bearer operator")).status());
        verify(ph).post(anyString(), anyString(), any());
    }

    @Test
    void explicitRetryKeepsTheSameOperatorSuppliedKey() {
        controls.control(request(), "Bearer operator");
        controls.control(request(), "Bearer operator");
        verify(ph, org.mockito.Mockito.times(2)).post("/orchestrator/api/swarms/qa/runs/run-1/start",
                "Bearer operator", WorkspaceJson.object().put("idempotencyKey", "same-key"));
    }

    @Test
    void literalIdentitiesAreEncodedWithoutChangingTheLinkedIdentity() {
        ObjectNode references = RuntimeObservationsTest.references();
        ObjectNode run = (ObjectNode) references.at("/runs/0");
        run.put("swarmId", "qa /?*").put("runId", "run+#1");
        when(linked.read("plan", "Bearer operator")).thenReturn(references);
        controls.control(request().put("swarmId", "qa /?*").put("runId", "run+#1"), "Bearer operator");
        verify(ph).post("/orchestrator/api/swarms/qa%20%2F%3F%2A/runs/run%2B%231/start",
                "Bearer operator", WorkspaceJson.object().put("idempotencyKey", "same-key"));
    }

    @Test
    void operationMatchesSwarmRunAndCorrelationExactly() {
        ObjectNode operation = WorkspaceJson.object().put("swarmId", "qa").put("correlationId", "op")
                .put("type", "START").put("state", "DISPATCHED");
        operation.set("runtime", WorkspaceJson.object().put("runId", "run-1"));
        when(ph.get("/orchestrator/api/swarms/qa/runs/run-1/operations/op", "Bearer operator")).thenReturn(operation);
        assertEquals(operation, controls.operation("plan", "qa", "run-1", "op", "Bearer operator"));
        for (Consumer<ObjectNode> mutate : List.<Consumer<ObjectNode>>of(row -> row.put("swarmId", "other"),
                row -> row.put("correlationId", "other"), row -> ((ObjectNode) row.get("runtime")).put("runId", "other"))) {
            ObjectNode invalid = operation.deepCopy();
            mutate.accept(invalid);
            when(ph.get(anyString(), anyString())).thenReturn(invalid);
            assertEquals(409, assertThrows(ApiFailure.class,
                    () -> controls.operation("plan", "qa", "run-1", "op", "Bearer operator")).status());
        }
    }

    private static ObjectNode request() {
        return WorkspaceJson.object().put("planId", "plan").put("swarmId", "qa").put("runId", "run-1")
                .put("action", "start").put("idempotencyKey", "same-key");
    }

    private static ObjectNode acknowledgement() {
        return WorkspaceJson.object().put("correlationId", "op").put("idempotencyKey", "same-key").put("timeoutMs", 180000);
    }
}
