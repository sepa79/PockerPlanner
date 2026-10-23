package io.pockethive.planner.http;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.domain.WorkspaceLimits;
import io.pockethive.planner.metadata.VersionInfo;
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
import java.util.concurrent.CompletableFuture;
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
class WorkspaceHttpTest {
    private static final Path DIRECTORY = directory();
    private static final IdentityFixture IDENTITY = identity();
    private static final String ADMIN = "Bearer phweb_http_admin";
    private static final String VIEWER = "Bearer phweb_http_viewer";
    @LocalServerPort int port;
    @Autowired WorkspaceStore store;
    @Autowired RevisionFeed revisions;
    @Autowired RevisionStreams streams;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry properties) {
        properties.add("TESTPLANNER_DB", () -> DIRECTORY.resolve("http.sqlite3").toString());
        properties.add("POCKETHIVE_AUTH_BASE_URL", IDENTITY::baseUrl);
    }

    @BeforeEach
    void reset() throws IOException {
        IDENTITY.reset();
        try (var input = getClass().getResourceAsStream("/contracts/workspace.json")) {
            ObjectNode fixture = WorkspaceJson.parse(input.readAllBytes());
            fixture.put("revision", store.readRevision());
            store.replaceExplicitly(fixture);
        }
    }

    @AfterAll
    void cleanup() throws IOException {
        streams.close();
        revisions.stop();
        IDENTITY.close();
        try (var files = Files.walk(DIRECTORY)) {
            for (Path path : files.sorted(java.util.Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    @Test
    void readsAndVersionArePublicWithoutAuthCallsAndHaveSecurityHeaders() throws Exception {
        var response = request("GET", "/api/state", null, null);
        assertEquals(200, response.statusCode());
        assertEquals(store.read(), json(response));
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        assertEquals("nosniff", response.headers().firstValue("X-Content-Type-Options").orElseThrow());
        assertEquals("no-referrer", response.headers().firstValue("Referrer-Policy").orElseThrow());
        assertTrue(response.headers().firstValue("Content-Security-Policy").orElseThrow().contains("frame-ancestors 'none'"));
        assertFalse(response.headers().firstValue("Access-Control-Allow-Origin").isPresent());
        var info = request("GET", "/api/info", null, null);
        assertEquals("PocketPlanner", json(info).get("name").textValue());
        assertEquals(VersionInfo.load().version(), json(info).get("version").textValue());
        assertEquals(0, IDENTITY.requests.get());
    }

    @Test
    void anonymousAndViewerWritesAreDeniedBeforeDomainParsing() throws Exception {
        ObjectNode before = store.read();
        for (String path : new String[]{"/api/state", "/api/state/import", "/api/activities"}) {
            assertEquals(401, request("PUT", path, null, "not-json".getBytes(StandardCharsets.UTF_8)).statusCode());
            assertEquals(403, request("PUT", path, VIEWER, "not-json".getBytes(StandardCharsets.UTF_8)).statusCode());
        }
        assertEquals(before, store.read());
    }

    @Test
    void everyWriteRevalidatesIdentityAndRevokedOrInactiveSessionsCannotSave() throws Exception {
        ObjectNode before = store.read();
        assertEquals(200, request("PUT", "/api/state", ADMIN, WorkspaceJson.encode(before)).statusCode());
        assertEquals(200, request("PUT", "/api/state", ADMIN, WorkspaceJson.encode(store.read())).statusCode());
        assertEquals(2, IDENTITY.requests.get());
        ObjectNode current = store.read();
        IDENTITY.active.set(false);
        assertEquals(401, request("PUT", "/api/state", ADMIN, WorkspaceJson.encode(current)).statusCode());
        IDENTITY.active.set(true);
        assertEquals(401, request("PUT", "/api/state", "Bearer phweb_revoked", WorkspaceJson.encode(current)).statusCode());
        assertEquals(current, store.read());
    }

    @Test
    void authOutageAndRedirectFailClosedWithoutLeakingDiagnosticsOrFollowingTheRedirect() throws Exception {
        ObjectNode before = store.read();
        for (int status : new int[]{503, 302}) {
            IDENTITY.responseStatus.set(status);
            var response = request("PUT", "/api/state", ADMIN, WorkspaceJson.encode(before));
            assertEquals(503, response.statusCode());
            assertFalse(new String(response.body(), StandardCharsets.UTF_8).contains("upstream-private-diagnostic"));
            assertEquals(before, store.read());
        }
        assertEquals(0, IDENTITY.redirected.get());
        assertEquals(200, request("GET", "/api/state", null, null).statusCode());
        assertEquals(200, request("GET", "/health", null, null).statusCode());
    }

    @Test
    void malformedDuplicateTrailingAndOversizedBodiesCannotChangeTheWorkspace() throws Exception {
        ObjectNode before = store.read();
        for (byte[] body : new byte[][]{
                "{}{}".getBytes(StandardCharsets.UTF_8),
                "{\"revision\":1,\"revision\":2}".getBytes(StandardCharsets.UTF_8),
                new byte[]{(byte) 0xc3, 0x28},
                " ".repeat(WorkspaceLimits.MAX_DOCUMENT_BYTES + 1).getBytes(StandardCharsets.UTF_8)}) {
            assertEquals(400, request("PUT", "/api/state", ADMIN, body).statusCode());
            assertEquals(before, store.read());
        }
        var publisher = HttpRequest.BodyPublishers.ofInputStream(() ->
                new java.io.ByteArrayInputStream(new byte[WorkspaceLimits.MAX_DOCUMENT_BYTES + 1]));
        var request = HttpRequest.newBuilder(uri("/api/state")).header("Authorization", ADMIN)
                .header("Content-Type", "application/json").PUT(publisher).timeout(Duration.ofSeconds(10)).build();
        assertEquals(400, client.send(request, HttpResponse.BodyHandlers.ofByteArray()).statusCode());
        assertEquals(before, store.read());
    }

    @Test
    void independentHttpWritersCannotOverwriteOneAnother() throws Exception {
        ObjectNode first = store.read();
        ObjectNode second = first.deepCopy();
        ((ObjectNode) first.at("/plans/0")).put("name", "First HTTP writer");
        ((ObjectNode) second.at("/plans/0")).put("name", "Second HTTP writer");
        var firstResponse = client.sendAsync(put("/api/state", ADMIN, WorkspaceJson.encode(first)), HttpResponse.BodyHandlers.ofByteArray());
        var secondResponse = client.sendAsync(put("/api/state", ADMIN, WorkspaceJson.encode(second)), HttpResponse.BodyHandlers.ofByteArray());
        CompletableFuture.allOf(firstResponse, secondResponse).get(10, java.util.concurrent.TimeUnit.SECONDS);
        int firstStatus = firstResponse.get().statusCode();
        int secondStatus = secondResponse.get().statusCode();
        assertNotEquals(firstStatus, secondStatus);
        assertTrue(firstStatus == 200 || firstStatus == 409);
        assertTrue(secondStatus == 200 || secondStatus == 409);
        assertEquals(json(firstStatus == 200 ? firstResponse.get() : secondResponse.get()), store.read());
    }

    @Test
    void explicitImportRestoresAndRemovesHistoricalFactsForExistingIds() throws Exception {
        ObjectNode replacement = store.read();
        ObjectNode activity = (ObjectNode) replacement.at("/plans/0/activities/0");
        activity.put("startedAt", "2026-01-06T09:00:00Z").put("completedAt", "2026-01-07T09:00:00Z").put("progress", 100);
        activity.put("blockerTrackingSince", "2026-01-06T09:00:00Z");
        activity.set("blockerIntervals", WorkspaceJson.array().add(WorkspaceJson.object()
                .put("issueId", "historical-deleted-issue").put("title", "Historical interruption")
                .put("startedAt", "2026-01-06T10:00:00Z").put("endedAt", "2026-01-06T11:00:00Z")));
        ObjectNode issue = (ObjectNode) replacement.at("/plans/0/issues/0");
        issue.put("open", false).put("resolvedAt", "2026-01-06T11:00:00Z");
        ObjectNode before = store.read();
        assertEquals(400, request("PUT", "/api/state", ADMIN, WorkspaceJson.encode(replacement)).statusCode());
        assertEquals(before, store.read());
        ObjectNode imported = json(request("PUT", "/api/state/import", ADMIN, WorkspaceJson.encode(replacement)));
        replacement.put("revision", before.get("revision").bigIntegerValue().add(java.math.BigInteger.ONE));
        assertEquals(WorkspaceJson.parse(WorkspaceJson.encode(replacement)), imported);
        assertEquals(imported, store.read());

        activity.put("startedAt", "2026-01-05T09:00:00Z").put("completedAt", "2026-01-08T09:00:00Z");
        issue.put("resolvedAt", "2026-01-07T11:00:00Z");
        before = store.read();
        assertEquals(400, request("PUT", "/api/state", ADMIN, WorkspaceJson.encode(replacement)).statusCode());
        assertEquals(before, store.read());
        imported = json(request("PUT", "/api/state/import", ADMIN, WorkspaceJson.encode(replacement)));
        replacement.put("revision", before.get("revision").bigIntegerValue().add(java.math.BigInteger.ONE));
        assertEquals(WorkspaceJson.parse(WorkspaceJson.encode(replacement)), imported);

        activity.remove(java.util.List.of("startedAt", "completedAt", "blockerTrackingSince", "blockerIntervals"));
        activity.put("progress", 0);
        issue.remove("resolvedAt");
        before = store.read();
        imported = json(request("PUT", "/api/state/import", ADMIN, WorkspaceJson.encode(replacement)));
        replacement.put("revision", before.get("revision").bigIntegerValue().add(java.math.BigInteger.ONE));
        assertEquals(WorkspaceJson.parse(WorkspaceJson.encode(replacement)), imported);
        assertEquals(imported, store.read());
    }

    @Test
    void importsAndOrdinaryWritesShareOneAtomicRevisionCheck() throws Exception {
        for (String secondPath : new String[]{"/api/state", "/api/state/import"}) {
            ObjectNode first = store.read();
            ObjectNode second = first.deepCopy();
            ((ObjectNode) first.at("/plans/0")).put("name", "Explicit import");
            ((ObjectNode) second.at("/plans/0")).put("name", "Concurrent writer");
            var firstResponse = client.sendAsync(put("/api/state/import", ADMIN, WorkspaceJson.encode(first)), HttpResponse.BodyHandlers.ofByteArray());
            var secondResponse = client.sendAsync(put(secondPath, ADMIN, WorkspaceJson.encode(second)), HttpResponse.BodyHandlers.ofByteArray());
            CompletableFuture.allOf(firstResponse, secondResponse).get(10, java.util.concurrent.TimeUnit.SECONDS);
            int firstStatus = firstResponse.get().statusCode();
            int secondStatus = secondResponse.get().statusCode();
            assertNotEquals(firstStatus, secondStatus);
            assertTrue(firstStatus == 200 || firstStatus == 409);
            assertTrue(secondStatus == 200 || secondStatus == 409);
            ObjectNode committed = json(firstStatus == 200 ? firstResponse.get() : secondResponse.get());
            assertEquals(first.get("revision").bigIntegerValue().add(java.math.BigInteger.ONE), store.readRevision());
            assertEquals(committed, store.read());
            assertEquals(409, request("PUT", "/api/state/import", ADMIN, WorkspaceJson.encode(first)).statusCode());
            assertEquals(committed, store.read());
        }
    }

    @Test
    void importRejectsInvalidBodiesRevokedIdentityAndAuthOutagesWithoutMutation() throws Exception {
        ObjectNode before = store.read();
        for (byte[] body : new byte[][]{
                "{}{}".getBytes(StandardCharsets.UTF_8),
                "{\"revision\":1,\"revision\":2}".getBytes(StandardCharsets.UTF_8),
                new byte[]{(byte) 0xc3, 0x28},
                " ".repeat(WorkspaceLimits.MAX_DOCUMENT_BYTES + 1).getBytes(StandardCharsets.UTF_8)}) {
            assertEquals(400, request("PUT", "/api/state/import", ADMIN, body).statusCode());
            assertEquals(before, store.read());
        }
        ObjectNode invalid = before.deepCopy();
        ((ObjectNode) invalid.at("/plans/0/activities/0")).put("streamId", "missing");
        assertEquals(400, request("PUT", "/api/state/import", ADMIN, WorkspaceJson.encode(invalid)).statusCode());
        assertEquals(before, store.read());
        assertEquals(401, request("PUT", "/api/state/import", "Bearer phweb_revoked", WorkspaceJson.encode(before)).statusCode());
        IDENTITY.active.set(false);
        assertEquals(401, request("PUT", "/api/state/import", ADMIN, WorkspaceJson.encode(before)).statusCode());
        IDENTITY.active.set(true);
        for (int status : new int[]{503, 302}) {
            IDENTITY.responseStatus.set(status);
            var response = request("PUT", "/api/state/import", ADMIN, WorkspaceJson.encode(before));
            assertEquals(503, response.statusCode());
            assertFalse(new String(response.body(), StandardCharsets.UTF_8).contains("upstream-private-diagnostic"));
            assertEquals(before, store.read());
        }
        assertEquals(0, IDENTITY.redirected.get());
    }

    @Test
    void editorLifecycleAndAssignmentsPassThroughTheSameStore() throws Exception {
        ObjectNode original = store.read();
        ObjectNode item = ((ObjectNode) original.at("/plans/0/activities/0")).deepCopy();
        item.put("started", true);
        ObjectNode started = json(request("PUT", "/api/activities", ADMIN, WorkspaceJson.encode(activityRequest(item))));
        assertTrue(started.at("/plans/0/activities/0/startedAt").isTextual());
        assertTrue(started.at("/plans/0/activities/0/blockerIntervals/0/endedAt").isNull());
        item.remove("started");
        item.put("progress", 50);
        item.set("issueIds", WorkspaceJson.array());
        ObjectNode unlinked = json(request("PUT", "/api/activities", ADMIN, WorkspaceJson.encode(activityRequest(item))));
        assertEquals("ACTIVITIES", unlinked.at("/plans/0/issues/0/scope").textValue());
        assertEquals(2, unlinked.at("/plans/0/issues/0/activityIds").size());
        assertTrue(unlinked.at("/plans/0/activities/0/blockerIntervals/0/endedAt").isTextual());
        item.put("progress", 100).put("done", true);
        ObjectNode completed = json(request("PUT", "/api/activities", ADMIN, WorkspaceJson.encode(activityRequest(item))));
        assertTrue(completed.at("/plans/0/activities/0/completedAt").isTextual());
        item.put("done", false);
        assertEquals(400, request("PUT", "/api/activities", ADMIN, WorkspaceJson.encode(activityRequest(item))).statusCode());
        item.put("progress", 35);
        ObjectNode reopened = json(request("PUT", "/api/activities", ADMIN, WorkspaceJson.encode(activityRequest(item))));
        assertFalse(reopened.at("/plans/0/activities/0").has("completedAt"));
        assertEquals(35, reopened.at("/plans/0/activities/0/progress").intValue());
        assertEquals(original.at("/plans/0/activities/0/start"), reopened.at("/plans/0/activities/0/start"));
    }

    @Test
    void jsonRoundtripPreservesIdsAndUnknownRoutesDoNotFallBackToAnotherRuntime() throws Exception {
        ObjectNode current = json(request("GET", "/api/state", null, null));
        ObjectNode saved = json(request("PUT", "/api/state", ADMIN, WorkspaceJson.encode(current)));
        assertEquals(current.get("plans"), saved.get("plans"));
        assertEquals(404, request("GET", "/auth/callback", null, null).statusCode());
        assertEquals(404, request("GET", "/not-a-planner-route", null, null).statusCode());
        assertEquals(405, request("GET", "/mcp", null, null).statusCode());
        assertEquals(405, request("POST", "/api/state", null, "{}".getBytes(StandardCharsets.UTF_8)).statusCode());
    }

    @Test
    void twoIndependentLiveClientsReceiveOnlyCommittedRevisionsFromHttpAndTheSameStore() throws Exception {
        try (LiveReader first = openEvents(); LiveReader second = openEvents()) {
            java.math.BigInteger initial = store.readRevision();
            assertEquals(initial, first.revisionAtLeast(initial));
            assertEquals(initial, second.revisionAtLeast(initial));
            ObjectNode draft = store.read();
            ((ObjectNode) draft.at("/plans/0")).put("name", "Synthetic live HTTP change");
            ObjectNode saved = json(request("PUT", "/api/state", ADMIN, WorkspaceJson.encode(draft)));
            java.math.BigInteger committed = saved.get("revision").bigIntegerValue();
            assertEquals(committed, first.revisionAtLeast(committed));
            assertEquals(committed, second.revisionAtLeast(committed));
            assertEquals(409, request("PUT", "/api/state", ADMIN, WorkspaceJson.encode(draft)).statusCode());
            assertEquals(committed, store.readRevision());
            ObjectNode external = store.read();
            ((ObjectNode) external.at("/plans/0")).put("description", "Synthetic same-owner import change");
            java.math.BigInteger imported = json(request("PUT", "/api/state/import", ADMIN,
                    WorkspaceJson.encode(external))).get("revision").bigIntegerValue();
            assertEquals(imported, first.revisionAtLeast(imported));
            assertEquals(imported, second.revisionAtLeast(imported));
        }
    }

    private LiveReader openEvents() throws Exception {
        var response = client.send(HttpRequest.newBuilder(uri("/api/events")).header("Accept", "text/event-stream")
                .timeout(Duration.ofSeconds(10)).GET().build(), HttpResponse.BodyHandlers.ofInputStream());
        assertEquals(200, response.statusCode());
        assertEquals("no", response.headers().firstValue("X-Accel-Buffering").orElseThrow());
        assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
        return new LiveReader(response.body());
    }

    private ObjectNode activityRequest(ObjectNode item) {
        ObjectNode request = WorkspaceJson.object().put("planId", "contract-plan").put("activityId", item.get("id").textValue());
        request.set("expectedRevision", store.read().get("revision"));
        request.set("item", item.deepCopy());
        return request;
    }

    private HttpResponse<byte[]> request(String method, String path, String authorization, byte[] body) throws Exception {
        var builder = HttpRequest.newBuilder(uri(path)).timeout(Duration.ofSeconds(10));
        if (authorization != null) {
            builder.header("Authorization", authorization);
        }
        if (body != null) {
            builder.header("Content-Type", "application/json");
        }
        return client.send(builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofByteArray(body)).build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private HttpRequest put(String path, String authorization, byte[] body) {
        return HttpRequest.newBuilder(uri(path)).header("Authorization", authorization).header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(10)).PUT(HttpRequest.BodyPublishers.ofByteArray(body)).build();
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private ObjectNode json(HttpResponse<byte[]> response) {
        assertEquals(200, response.statusCode(), () -> new String(response.body(), StandardCharsets.UTF_8));
        return WorkspaceJson.parse(response.body());
    }

    private static Path directory() {
        try {
            return Files.createTempDirectory("pocketplanner-http-test-");
        } catch (IOException exception) {
            throw new java.io.UncheckedIOException(exception);
        }
    }

    private static IdentityFixture identity() {
        try {
            return new IdentityFixture();
        } catch (IOException exception) {
            throw new java.io.UncheckedIOException(exception);
        }
    }
}
