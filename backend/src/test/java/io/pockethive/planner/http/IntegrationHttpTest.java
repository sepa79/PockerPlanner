package io.pockethive.planner.http;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.integration.PlannerCatalogue;
import io.pockethive.planner.live.RevisionFeed;
import io.pockethive.planner.live.RevisionStreams;
import io.pockethive.planner.persistence.WorkspaceStore;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class IntegrationHttpTest {
    private static final Path DIRECTORY = directory();
    private static final RuntimeHttpFixture PH = fixture();
    @LocalServerPort int port;
    @Autowired WorkspaceStore store;
    @Autowired PlannerCatalogue catalogue;
    @Autowired RevisionFeed revisions;
    @Autowired RevisionStreams streams;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
    private ObjectNode before;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry properties) {
        properties.add("TESTPLANNER_DB", () -> DIRECTORY.resolve("integration.sqlite3").toString());
        properties.add("POCKETHIVE_AUTH_BASE_URL", () -> PH.origin() + "/auth-service");
        properties.add("POCKETHIVE_BASE_URL", PH::origin);
        properties.add("POCKETHIVE_PUBLIC_URL", PH::origin);
        properties.add("POCKETPLANNER_INSTANCE_ID", () -> "integration-qa");
    }

    @BeforeEach
    void setup() throws IOException {
        PH.requests.clear();
        PH.status.set(200);
        PH.operationRun = "run-1";
        try (var input = getClass().getResourceAsStream("/contracts/workspace.json")) {
            ObjectNode fixture = WorkspaceJson.parse(input.readAllBytes());
            fixture.put("revision", store.readRevision());
            before = store.replaceExplicitly(fixture);
        }
        String tag = catalogue.catalogue().at("/plans/0/activities/0/tag").textValue();
        PH.runs = "[{\"swarmId\":\"qa\",\"runId\":\"run-1\",\"scenarioId\":\"scenario\","
                + "\"testPlan\":\"pp:integration-qa:contract-plan\",\"tags\":[\"" + tag + "\"]}]";
        PH.runtimes = "[{\"id\":\"qa\",\"runId\":\"run-1\",\"runtimeIntent\":\"PRESENT\",\"workloadIntent\":\"RUNNING\","
                + "\"controllerState\":\"READY\",\"workloadState\":\"RUNNING\",\"health\":\"HEALTHY\","
                + "\"runtimeResourceState\":\"PRESENT\",\"observationStale\":false,\"observation\":{\"workers\":[]}}]";
    }

    @AfterAll
    void cleanup() throws IOException {
        streams.close();
        revisions.stop();
        PH.close();
        try (var paths = Files.walk(DIRECTORY)) {
            for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    @Test
    void anonymousCannotReadProtectedDataOrControlBeforeBodyParsing() throws Exception {
        for (String path : new String[]{"catalogue", "runs", "execution", "operation"}) {
            assertEquals(401, request("GET", "/api/integration/" + path, null, null).statusCode());
        }
        assertEquals(401, request("POST", "/api/integration/control", null, "not JSON").statusCode());
        assertTrue(PH.requests.isEmpty());
        assertEquals(before, store.read());
    }

    @Test
    void viewerReadsCatalogueAndExactRuntimeWithoutBeingGrantedPlannerEditing() throws Exception {
        String viewer = "Bearer phweb_http_viewer";
        assertEquals(200, request("GET", "/api/integration/catalogue", viewer, null).statusCode());
        ObjectNode result = json(request("GET", "/api/integration/execution?planId=contract-plan", viewer, null));
        assertEquals("run-1", result.at("/runs/0/runtime/runId").textValue());
        assertTrue(result.at("/runs/0/canStart").booleanValue());
        assertFalse(result.at("/runs/0/canStop").booleanValue());
        assertTrue(PH.requests.stream().allMatch(item -> item.contains(viewer)));
        assertEquals(403, request("PUT", "/api/state", viewer, before.toString()).statusCode());
        assertEquals(before, store.read());
    }

    @Test
    void phOwnsControlPermissionAndOutcomeWhilePlannerFactsStayUnchanged() throws Exception {
        String viewer = "Bearer phweb_http_viewer";
        String body = "{\"planId\":\"contract-plan\",\"swarmId\":\"qa\",\"runId\":\"run-1\","
                + "\"action\":\"start\",\"idempotencyKey\":\"same-key\"}";
        var accepted = request("POST", "/api/integration/control", viewer, body);
        assertEquals(202, accepted.statusCode());
        assertEquals("op", WorkspaceJson.parse(accepted.body()).get("correlationId").textValue());
        assertEquals(1, PH.requests.stream().filter(item -> item.startsWith("POST ")).count());
        var outcome = request("GET", "/api/integration/operation?planId=contract-plan&swarmId=qa&runId=run-1&correlationId=op", viewer, null);
        assertEquals("SUCCEEDED", json(outcome).get("state").textValue());
        PH.operationRun = "replacement";
        assertEquals(409, request("GET", "/api/integration/operation?planId=contract-plan&swarmId=qa&runId=run-1&correlationId=op", viewer, null).statusCode());
        assertEquals(403, request("POST", "/api/integration/control", "Bearer phweb_http_admin", body.replace("\"start\"", "\"stop\"")).statusCode());
        assertEquals(before, store.read());
    }

    @Test
    void revokedSessionOutageAndUnknownRunFailWithoutRetryOrLostPlanningState() throws Exception {
        assertEquals(401, request("GET", "/api/integration/catalogue", "Bearer phweb_revoked", null).statusCode());
        assertEquals(400, request("GET", "/api/integration/execution?planId=missing", "Bearer phweb_http_viewer", null).statusCode());
        PH.status.set(500);
        var failure = request("GET", "/api/integration/execution?planId=contract-plan", "Bearer phweb_http_viewer", null);
        assertEquals(503, failure.statusCode());
        assertFalse(new String(failure.body(), StandardCharsets.UTF_8).contains("private PH"));
        assertEquals(before, json(request("GET", "/api/state", null, null)));
    }

    private HttpResponse<byte[]> request(String method, String path, String authorization, String body) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(10));
        if (authorization != null) {
            builder.header("Authorization", authorization);
        }
        if (body != null) {
            builder.header("Content-Type", "application/json");
        }
        return http.send(builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private static ObjectNode json(HttpResponse<byte[]> response) {
        assertEquals(200, response.statusCode());
        return WorkspaceJson.parse(response.body());
    }

    private static Path directory() {
        try {
            return Files.createTempDirectory("pocketplanner-integration-test-");
        } catch (IOException failure) {
            throw new java.io.UncheckedIOException(failure);
        }
    }

    private static RuntimeHttpFixture fixture() {
        try {
            return new RuntimeHttpFixture();
        } catch (IOException failure) {
            throw new java.io.UncheckedIOException(failure);
        }
    }
}
