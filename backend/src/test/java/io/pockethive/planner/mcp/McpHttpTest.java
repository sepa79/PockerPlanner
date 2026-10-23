package io.pockethive.planner.mcp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.modelcontextprotocol.spec.McpSchema;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.domain.WorkspaceLimits;
import io.pockethive.planner.metadata.VersionInfo;
import io.pockethive.planner.live.RevisionFeed;
import io.pockethive.planner.live.RevisionStreams;
import io.pockethive.planner.persistence.WorkspaceStore;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class McpHttpTest {
    private static final Path DIRECTORY = directory();
    private static final McpIdentityFixture IDENTITY = identity();
    private static final String PLAN = "contract-plan";
    private static final String ACTIVITY = "activity-alpha-minimal";
    private static final String ADMIN = McpIdentityFixture.ADMIN;
    private static final String VIEWER = McpIdentityFixture.VIEWER;
    @LocalServerPort int port;
    @Autowired WorkspaceStore store;
    @Autowired RevisionFeed feed;
    @Autowired RevisionStreams streams;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry properties) {
        properties.add("TESTPLANNER_DB", () -> DIRECTORY.resolve("mcp.sqlite3").toString());
        properties.add("POCKETHIVE_AUTH_BASE_URL", IDENTITY::baseUrl);
        properties.add("POCKETPLANNER_MCP_ALLOWED_HOSTS", () -> "planner.example:*");
        properties.add("POCKETPLANNER_MCP_ALLOWED_ORIGINS", () -> "https://client.example:*");
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
        feed.stop();
        IDENTITY.close();
        try (var files = Files.walk(DIRECTORY)) {
            for (Path path : files.sorted(java.util.Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    @Test
    void officialClientNegotiatesVersionAndExposesExactlySevenEquivalentSchemasAndAnnotations() {
        try (var connection = connection(null)) {
            var initialization = connection.client.initialize();
            assertEquals("PocketPlanner", initialization.serverInfo().name());
            assertEquals(VersionInfo.load().version(), initialization.serverInfo().version());
            assertTrue(initialization.instructions().contains("untrusted data"));
            var tools = connection.client.listTools().tools();
            assertEquals(List.of("create_plan", "create_plan_item", "get_access", "get_plan", "list_plans", "update_plan", "update_plan_item"),
                tools.stream().map(McpSchema.Tool::name).sorted().toList());
            for (var tool : tools) {
                boolean read = List.of("get_access", "get_plan", "list_plans").contains(tool.name());
                assertEquals(read, tool.annotations().readOnlyHint());
                assertEquals(read, tool.annotations().idempotentHint());
                assertEquals(tool.name().startsWith("update_"), tool.annotations().destructiveHint());
                assertFalse(tool.annotations().openWorldHint());
                assertEquals(false, tool.inputSchema().get("additionalProperties"));
                if (!read) {
                    var properties = (Map<?, ?>) tool.inputSchema().get("properties");
                    assertEquals("integer", ((Map<?, ?>) properties.get("expected_revision")).get("type"));
                }
            }
            assertTrue(IDENTITY.headers().isEmpty());
        }
    }

    @Test
    void identityIsFreshPerRequestEvenOnOneInitializedConnectionAndNeverComesFromArgumentsOrMeta() {
        try (var connection = connection(ADMIN)) {
            connection.client.initialize();
            assertTrue(ok(call(connection, "get_access", Map.of())).get("canEdit").booleanValue());
            var first = ok(call(connection, "update_plan", planPatch(Map.of("description", "first"), revision())));
            connection.authorization.set(VIEWER);
            var viewer = ok(call(connection, "get_access", Map.of()));
            assertFalse(viewer.get("canEdit").booleanValue());
            assertEquals("viewer", viewer.at("/user/username").textValue());
            error(call(connection, "update_plan", planPatch(Map.of("description", "denied"), revision())), "AUTH_403");
            connection.authorization.set(null);
            var anonymous = ok(call(connection, "get_access", Map.of()));
            assertTrue(anonymous.get("user").isNull());
            assertFalse(anonymous.get("canEdit").booleanValue());
            error(call(connection, "update_plan", planPatch(Map.of("description", "denied"), revision())), "AUTH_401");
            var forged = new McpSchema.CallToolRequest("update_plan", planPatch(Map.of("description", "denied"), revision()),
                Map.of("Authorization", ADMIN, McpConfiguration.AUTHORIZATION, ADMIN));
            error(connection.client.callTool(forged), "AUTH_401");
            connection.authorization.set(ADMIN);
            var second = ok(call(connection, "update_plan", planPatch(Map.of("description", "second"), revision())));
            assertEquals(first.get("revision").bigIntegerValue().add(BigInteger.ONE), second.get("revision").bigIntegerValue());
            assertEquals(List.of(ADMIN, ADMIN, VIEWER, VIEWER, ADMIN), IDENTITY.headers());
        }
    }

    @Test
    void concurrentClientsCannotBorrowIdentityAndPublicReadsNeedNoVerifiedIdentity() {
        try (var admin = connection(ADMIN); var viewer = connection(VIEWER); var anonymous = connection(null)) {
            admin.client.initialize();
            viewer.client.initialize();
            anonymous.client.initialize();
            List<CompletableFuture<Void>> pending = new ArrayList<>();
            for (int index = 0; index < 6; index++) {
                pending.add(CompletableFuture.runAsync(() -> assertTrue(ok(call(admin, "get_access", Map.of())).get("canEdit").booleanValue())));
                pending.add(CompletableFuture.runAsync(() -> assertFalse(ok(call(viewer, "get_access", Map.of())).get("canEdit").booleanValue())));
                pending.add(CompletableFuture.runAsync(() -> assertTrue(ok(call(anonymous, "get_access", Map.of())).get("user").isNull())));
            }
            CompletableFuture.allOf(pending.toArray(CompletableFuture[]::new)).join();
            assertEquals(6, IDENTITY.headers().stream().filter(ADMIN::equals).count());
            assertEquals(6, IDENTITY.headers().stream().filter(VIEWER::equals).count());
            anonymous.authorization.set("Bearer phweb_revoked");
            assertEquals(PLAN, ok(call(anonymous, "get_plan", Map.of("plan_id", PLAN))).at("/plan/id").textValue());
            assertEquals(1, ok(call(anonymous, "list_plans", Map.of())).get("plans").size());
            error(call(anonymous, "get_access", Map.of()), "AUTH_401");
        }
    }

    @Test
    void freshRevocationInactiveIdentityAndUpstreamFailuresDenyEveryWriteWithoutLeakingDiagnostics() {
        try (var connection = initialized(ADMIN)) {
            var before = store.read();
            IDENTITY.active.set(false);
            error(call(connection, "update_plan", planPatch(Map.of("name", "denied"), revision())), "AUTH_401");
            IDENTITY.active.set(true);
            connection.authorization.set("Bearer phweb_revoked");
            error(call(connection, "update_plan", planPatch(Map.of("name", "denied"), revision())), "AUTH_401");
            connection.authorization.set(ADMIN);
            for (int status : List.of(503, 302)) {
                IDENTITY.status.set(status);
                var result = call(connection, "update_plan", planPatch(Map.of("name", "denied"), revision()));
                error(result, "AUTH_503");
                assertFalse(McpToolsTest.text(result).contains("private-upstream"));
            }
            assertEquals(before, store.read());
            assertEquals(4, IDENTITY.headers().size());
        }
    }

    @Test
    void deadlinesAndAllCollectionCommandsPreserveCanonicalShapeAndRejectInvalidReferences() {
        try (var connection = initialized(ADMIN)) {
            var created = ok(call(connection, "create_plan", Map.of("plan_id", "new-plan", "name", "Synthetic", "description", "",
                "deadline", "2026-10-30", "expected_revision", revision())));
            assertEquals(2, created.size());
            assertEquals("2026-10-30", created.at("/plan/deadline").textValue());
            Map<String, Object> nullable = new LinkedHashMap<>();
            nullable.put("deadline", null);
            assertTrue(ok(call(connection, "update_plan", Map.of("plan_id", "new-plan", "changes", nullable,
                "expected_revision", revision()))).at("/plan/deadline").isNull());
            ok(call(connection, "create_plan_item", itemCreate("streams", Map.of("id", "new-stream", "name", "Synthetic", "description", ""))));
            ok(call(connection, "create_plan_item", itemCreate("activityTypes", Map.of("id", "new-type", "name", "Synthetic", "color", "#123456"))));
            ok(call(connection, "create_plan_item", itemCreate("activities", Map.of("id", "new-activity", "name", "Synthetic", "streamId", "new-stream",
                "typeId", "new-type", "start", "2026-10-19", "durationDays", 1, "progress", 0, "status", "", "issueIds", List.of(), "jiraUrl", ""))));
            ok(call(connection, "create_plan_item", itemCreate("issues", Map.ofEntries(Map.entry("id", "new-issue"),
                Map.entry("title", "Synthetic"), Map.entry("description", ""), Map.entry("scope", "ACTIVITIES"),
                Map.entry("streamIds", List.of()), Map.entry("activityIds", List.of("new-activity")), Map.entry("blocker", false),
                Map.entry("discovered", "2026-10-19"), Map.entry("open", true), Map.entry("descriptionIncomplete", false), Map.entry("jiraUrl", "")))));
            var snapshot = store.read();
            for (Map<String, Object> changes : List.of(Map.<String, Object>of("deadline", "2026-02-30"), Map.<String, Object>of("deadline", 123), Map.<String, Object>of("name", "", "id", "rename"))) {
                error(call(connection, "update_plan", planPatch(changes, revision())), "INVALID_INPUT");
            }
            error(call(connection, "update_plan_item", itemPatch("activities", ACTIVITY, Map.of("streamId", "missing"))), "INVALID_INPUT");
            error(call(connection, "update_plan_item", itemPatch("activities", ACTIVITY, Map.of("dependsOn", "activity-beta-minimal"))), "INVALID_INPUT");
            error(call(connection, "create_plan_item", itemCreate("streams", Map.of("id", "new-stream", "name", "duplicate", "description", ""))), "INVALID_INPUT");
            assertEquals(snapshot, store.read());
        }
    }

    @Test
    void executionAndIssueScopeUseTheSameTransactionalLifecycleOwner() {
        try (var connection = initialized(ADMIN)) {
            var started = ok(call(connection, "update_plan_item", itemPatch("activities", ACTIVITY, Map.of("started", true))));
            assertTrue(started.at("/plan/activities/0/startedAt").isTextual());
            assertTrue(started.at("/plan/activities/0/blockerIntervals/0/startedAt").isTextual());
            var narrowed = ok(call(connection, "update_plan_item", itemPatch("activities", ACTIVITY, Map.of("issueIds", List.of()))));
            assertEquals("ACTIVITIES", narrowed.at("/plan/issues/0/scope").textValue());
            assertEquals(List.of("activity-alpha-heavy", "activity-beta-minimal"),
                McpConfiguration.protocolMapper().convertValue(narrowed.at("/plan/issues/0/activityIds"), List.class));
            var completed = ok(call(connection, "update_plan_item", itemPatch("activities", ACTIVITY, Map.of("progress", 100, "done", true))));
            assertTrue(completed.at("/plan/activities/0/completedAt").isTextual());
            error(call(connection, "update_plan_item", itemPatch("activities", ACTIVITY, Map.of("done", false))), "INVALID_INPUT");
            var reopened = ok(call(connection, "update_plan_item", itemPatch("activities", ACTIVITY, Map.of("done", false, "progress", 25))));
            assertFalse(reopened.at("/plan/activities/0").has("completedAt"));
            assertEquals(started.at("/plan/activities/0/startedAt"), reopened.at("/plan/activities/0/startedAt"));
            var closedIssue = ok(call(connection, "update_plan_item", itemPatch("issues", "issue-shared-blocker", Map.of("open", false))));
            assertTrue(closedIssue.at("/plan/issues/0/resolvedAt").isTextual());
            var reopenedIssue = ok(call(connection, "update_plan_item", itemPatch("issues", "issue-shared-blocker", Map.of("open", true))));
            assertTrue(reopenedIssue.at("/plan/issues/0/resolvedAt").isNull() || reopenedIssue.at("/plan/issues/0/resolvedAt").isMissingNode());
            error(call(connection, "update_plan_item", itemPatch("issues", "issue-shared-blocker", Map.of("resolvedAt", "2026-01-01T00:00:00Z"))), "INVALID_INPUT");
            error(call(connection, "update_plan_item", itemPatch("activities", ACTIVITY, Map.of("executionTrackedAt", "2026-01-01T00:00:00Z"))), "INVALID_INPUT");
        }
    }

    @Test
    void literalScalarsUnknownArgumentsAndNestedDomainFieldsNeverCoerceOrSave() {
        try (var connection = initialized(ADMIN)) {
            ObjectNode before = store.read();
            for (Object invalid : List.of("1", 1.0, true, -1, new java.math.BigDecimal("1.000"))) {
                error(call(connection, "update_plan", planPatch(Map.of("name", "rejected"), invalid)), "INVALID_INPUT");
            }
            Map<String, Object> nullRevision = planPatch(Map.of("name", "rejected"), null);
            error(call(connection, "update_plan", nullRevision), "INVALID_INPUT");
            for (Map<String, Object> arguments : List.of(Map.<String, Object>of("plan_id", 123),
                Map.<String, Object>of("plan_id", PLAN, "unexpected", true))) {
                error(call(connection, "get_plan", arguments), "INVALID_INPUT");
            }
            for (Map<String, Object> changes : List.of(Map.<String, Object>of("progress", "25"), Map.<String, Object>of("progress", 25.0),
                Map.<String, Object>of("includeWeekends", "true"), Map.<String, Object>of("started", 1), Map.<String, Object>of("name", true), Map.<String, Object>of("unknown", true))) {
                error(call(connection, "update_plan_item", itemPatch("activities", ACTIVITY, changes)), "INVALID_INPUT");
            }
            error(call(connection, "update_plan", Map.of("plan_id", PLAN, "changes", List.of(), "expected_revision", revision())), "INVALID_INPUT");
            error(call(connection, "update_plan_item", Map.of("plan_id", PLAN, "collection", "not-a-collection", "item_id", ACTIVITY,
                "changes", Map.of("progress", 1), "expected_revision", revision())), "INVALID_INPUT");
            assertEquals(before, store.read());
        }
    }

    @Test
    void concurrentRestAndMcpWritersHaveOneWinnerAndRejectStaleWithoutLostUpdates() {
        try (var connection = initialized(ADMIN)) {
            var before = store.read();
            var revision = revision();
            var restDraft = before.deepCopy();
            ((ObjectNode) restDraft.at("/plans/0")).put("name", "REST winner");
            var rest = CompletableFuture.supplyAsync(() -> {
                try {
                    return http.send(HttpRequest.newBuilder(URI.create(baseUrl() + "/api/state"))
                        .header("Authorization", ADMIN).header("Content-Type", "application/json")
                        .PUT(HttpRequest.BodyPublishers.ofByteArray(WorkspaceJson.encode(restDraft))).build(), HttpResponse.BodyHandlers.ofByteArray());
                } catch (Exception failure) {
                    throw new RuntimeException(failure);
                }
            });
            var mcp = CompletableFuture.supplyAsync(() -> call(connection, "update_plan", planPatch(Map.of("name", "MCP winner"), revision)));
            var restResult = rest.join();
            var mcpResult = mcp.join();
            assertNotEquals(restResult.statusCode() == 200, !mcpResult.isError());
            assertEquals(mcpResult.isError() ? 200 : 409, restResult.statusCode());
            if (mcpResult.isError()) {
                error(mcpResult, "REVISION_CONFLICT");
            } else {
                assertEquals("MCP winner", ok(mcpResult).at("/plan/name").textValue());
            }
            assertEquals(revision.add(BigInteger.ONE), revision());
            error(call(connection, "update_plan", planPatch(Map.of("name", "stale"), revision)), "REVISION_CONFLICT");
            assertEquals(revision.add(BigInteger.ONE), revision());
        }
    }

    @Test
    void postCommitInvalidatesTheExistingBrowserSseFeed() throws Exception {
        var events = http.send(HttpRequest.newBuilder(URI.create(baseUrl() + "/api/events"))
            .header("Accept", "text/event-stream").GET().build(), HttpResponse.BodyHandlers.ofInputStream());
        assertEquals(200, events.statusCode());
        try (var input = events.body(); var reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
                var connection = initialized(ADMIN)) {
            BigInteger committed = ok(call(connection, "update_plan", planPatch(Map.of("name", "MCP live commit"), revision())))
                .get("revision").bigIntegerValue();
            var notification = CompletableFuture.supplyAsync(() -> {
                try {
                    for (String line; (line = reader.readLine()) != null;) {
                        if (line.startsWith("data:")) {
                            var data = WorkspaceJson.parse(line.substring(5).strip().getBytes(StandardCharsets.UTF_8));
                            if (data.path("revision").isIntegralNumber() && data.get("revision").bigIntegerValue().equals(committed)) {
                                return committed;
                            }
                        }
                    }
                    throw new AssertionError("SSE stream ended before the committed revision");
                } catch (IOException failure) {
                    throw new RuntimeException(failure);
                }
            });
            assertEquals(committed, notification.get(5, TimeUnit.SECONDS));
        }
    }

    @Test
    void smallScopedCommandCannotOverflowTheCanonicalSavedWorkspaceIncludingServerOwnedFacts() {
        ObjectNode initial = store.read();
        ObjectNode activity = (ObjectNode) initial.at("/plans/0/activities/0");
        activity.put("syntheticPadding", "");
        int remaining = WorkspaceLimits.MAX_DOCUMENT_BYTES - WorkspaceJson.encode(initial).length - 2;
        activity.put("syntheticPadding", "x".repeat(remaining));
        ObjectNode full = store.write(initial);
        try (var connection = initialized(ADMIN)) {
            error(call(connection, "update_plan_item", itemPatch("activities", ACTIVITY, Map.of("started", true))), "INVALID_INPUT");
            assertEquals(full, store.read());
            assertFalse(store.read().at("/plans/0/activities/0").has("startedAt"));
        }
    }

    @Test
    void actualHttpHostAndRepeatedAuthorizationAreRejectedWithoutTrustingForwardedHeaders() throws Exception {
        assertEquals(421, rawHeaders("Host: evil.example\r\nX-Forwarded-Host: localhost:" + port + "\r\n"));
        assertEquals(200, rawHeaders("Host: planner.example:8443\r\n"));
        assertEquals(400, rawHeaders("Host: localhost:" + port + "\r\nAuthorization: " + ADMIN + "\r\nAuthorization: " + VIEWER + "\r\n"));
        assertEquals(403, rawHeaders("Host: localhost:" + port + "\r\nOrigin: http://localhost:123\r\nOrigin: https://evil.example\r\n"));
        assertTrue(IDENTITY.headers().isEmpty());
    }

    @Test
    void rawTransportBoundsKnownAndChunkedBodiesAndRejectsMalformedUtf8DuplicateOrTrailingJson() throws Exception {
        var before = store.read();
        for (String invalid : List.of("{} {}", "{\"id\":1,\"id\":2}", "{\"name\":\"\\ud800\"}", "{\"number\":NaN}", "[]")) {
            assertEquals(400, raw(invalid.getBytes(StandardCharsets.UTF_8), false, Map.of()).statusCode());
        }
        assertEquals(400, raw(new byte[]{'{', '"', 'x', '"', ':', '"', (byte) 0xc3, '"', '}'}, false, Map.of()).statusCode());
        byte[] oversized = new byte[WorkspaceLimits.MAX_DOCUMENT_BYTES + 1];
        java.util.Arrays.fill(oversized, (byte) ' ');
        assertEquals(413, raw(oversized, false, Map.of()).statusCode());
        assertEquals(413, raw(oversized, true, Map.of()).statusCode());
        var ping = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}".getBytes(StandardCharsets.UTF_8);
        byte[] exact = java.util.Arrays.copyOf(ping, WorkspaceLimits.MAX_DOCUMENT_BYTES);
        java.util.Arrays.fill(exact, ping.length, exact.length, (byte) ' ');
        var exactResponse = raw(exact, true, Map.of());
        assertEquals(200, exactResponse.statusCode(), () -> new String(exactResponse.body(), StandardCharsets.UTF_8));
        assertEquals(403, raw(ping, false, Map.of("Origin", "https://evil.example")).statusCode());
        assertEquals(200, raw(ping, false, Map.of("Origin", "https://client.example:8443")).statusCode());
        var deniedGet = http.send(HttpRequest.newBuilder(URI.create(baseUrl() + "/mcp"))
            .header("Origin", "https://evil.example").GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(403, deniedGet.statusCode());
        var invalidProtocol = raw("{}".getBytes(StandardCharsets.UTF_8), false, Map.of());
        assertEquals(400, invalidProtocol.statusCode());
        assertFalse(new String(invalidProtocol.body(), StandardCharsets.UTF_8).contains("stackTrace"));
        assertFalse(new String(invalidProtocol.body(), StandardCharsets.UTF_8).contains("cause"));
        assertEquals(before, store.read());
        assertTrue(IDENTITY.headers().isEmpty());
    }

    private int rawHeaders(String headers) throws IOException {
        String body = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}";
        try (var socket = new java.net.Socket("127.0.0.1", port)) {
            socket.setSoTimeout(5000);
            socket.getOutputStream().write(("POST /mcp HTTP/1.1\r\n" + headers
                + "Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\nConnection: close\r\nContent-Length: "
                + body.length() + "\r\n\r\n" + body).getBytes(StandardCharsets.UTF_8));
            var reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            return Integer.parseInt(reader.readLine().split(" ")[1]);
        }
    }

    private HttpResponse<byte[]> raw(byte[] body, boolean chunked, Map<String, String> headers) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create(baseUrl() + "/mcp"))
            .timeout(Duration.ofSeconds(10)).header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream");
        headers.forEach(builder::header);
        return http.send(builder.POST(chunked ? HttpRequest.BodyPublishers.ofInputStream(() -> new java.io.ByteArrayInputStream(body))
            : HttpRequest.BodyPublishers.ofByteArray(body)).build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private Map<String, Object> itemCreate(String collection, Map<String, Object> item) {
        return Map.of("plan_id", PLAN, "collection", collection, "item", item, "expected_revision", revision());
    }

    private Map<String, Object> itemPatch(String collection, String itemId, Map<String, Object> changes) {
        return Map.of("plan_id", PLAN, "collection", collection, "item_id", itemId, "changes", changes, "expected_revision", revision());
    }

    private Map<String, Object> planPatch(Map<String, Object> changes, Object revision) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("plan_id", PLAN);
        result.put("changes", changes);
        result.put("expected_revision", revision);
        return result;
    }

    private BigInteger revision() {
        return store.readRevision();
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + port;
    }

    private McpClientFixture connection(String authorization) {
        return new McpClientFixture(baseUrl(), authorization);
    }

    private McpClientFixture initialized(String authorization) {
        var connection = connection(authorization);
        connection.client.initialize();
        return connection;
    }

    private static McpSchema.CallToolResult call(McpClientFixture connection, String tool, Map<String, Object> arguments) {
        return connection.client.callTool(new McpSchema.CallToolRequest(tool, arguments));
    }

    private static ObjectNode ok(McpSchema.CallToolResult result) {
        assertFalse(result.isError(), () -> McpToolsTest.text(result));
        var content = WorkspaceJson.parse(McpToolsTest.text(result).getBytes(StandardCharsets.UTF_8));
        assertEquals(content, WorkspaceJson.parse(bytes(result.structuredContent())));
        return content;
    }

    private static byte[] bytes(Object value) {
        try {
            return McpConfiguration.protocolMapper().writeValueAsBytes(value);
        } catch (IOException failure) {
            throw new RuntimeException(failure);
        }
    }

    private static void error(McpSchema.CallToolResult result, String code) {
        assertTrue(result.isError(), () -> McpToolsTest.text(result));
        assertTrue(McpToolsTest.text(result).startsWith(code + ":"), () -> McpToolsTest.text(result));
    }

    private static Path directory() {
        try {
            return Files.createTempDirectory("planner-mcp-synthetic-");
        } catch (IOException failure) {
            throw new ExceptionInInitializerError(failure);
        }
    }

    private static McpIdentityFixture identity() {
        try {
            return new McpIdentityFixture();
        } catch (IOException failure) {
            throw new ExceptionInInitializerError(failure);
        }
    }
}
