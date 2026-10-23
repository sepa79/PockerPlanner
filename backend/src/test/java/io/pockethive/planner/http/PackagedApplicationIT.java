package io.pockethive.planner.http;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.WorkspaceJson;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PackagedApplicationIT {
    @TempDir Path temporary;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    @Test
    void packagedHttpApplicationRestartsWithIdenticalFactsAndNoSiblingDirectories() throws Exception {
        try (IdentityFixture identity = new IdentityFixture()) {
            Path database = temporary.resolve("persistent.sqlite3");
            ObjectNode saved;
            try (ApplicationProcess application = start("first", database, identity.baseUrl())) {
                assertEquals(0, json(get(application, "/api/state", null)).get("revision").intValue());
                try (var input = getClass().getResourceAsStream("/contracts/workspace.json")) {
                    saved = json(put(application, "/api/state", WorkspaceJson.parse(input.readAllBytes())));
                }
                ObjectNode item = ((ObjectNode) saved.at("/plans/0/activities/0")).deepCopy();
                item.put("started", true);
                ObjectNode request = WorkspaceJson.object().put("planId", "contract-plan").put("activityId", item.get("id").textValue());
                request.set("expectedRevision", saved.get("revision"));
                request.set("item", item);
                saved = json(put(application, "/api/activities", request));
                item.remove("started");
                item.put("progress", 100).put("done", true);
                request.set("expectedRevision", saved.get("revision"));
                saved = json(put(application, "/api/activities", request));
                assertTrue(saved.at("/plans/0/activities/0/blockerIntervals/0/endedAt").isTextual());
            }
            try (ApplicationProcess restarted = start("second", database, identity.baseUrl())) {
                assertEquals(saved, json(get(restarted, "/api/state", null)));
                assertEquals("PocketPlanner", json(get(restarted, "/api/info", null)).get("name").textValue());
                assertTrue(json(get(restarted, "/api/session", "Bearer phweb_http_admin")).get("canEdit").booleanValue());
            }
        }
    }

    @Test
    void unconfiguredAuthStillAllowsViewingButNeverPermitsAnAuthenticatedWrite() throws Exception {
        try (ApplicationProcess application = start("unconfigured", temporary.resolve("readonly.sqlite3"), "")) {
            ObjectNode state = json(get(application, "/api/state", null));
            ObjectNode session = json(get(application, "/api/session", null));
            assertFalse(session.get("configured").booleanValue());
            assertFalse(session.get("canEdit").booleanValue());
            assertEquals(503, put(application, "/api/state", state).statusCode());
            assertEquals(state, json(get(application, "/api/state", null)));
        }
    }

    @Test
    void packagedMcpServletNegotiatesAndExposesOnlyScopedTools() throws Exception {
        try (ApplicationProcess application = start("mcp", temporary.resolve("mcp.sqlite3"), "")) {
            for (String message : List.of(
                    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-11-25\","
                            + "\"capabilities\":{},\"clientInfo\":{\"name\":\"synthetic-package-check\",\"version\":\"1\"}}}",
                    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}")) {
                var response = http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + application.port + "/mcp"))
                        .timeout(Duration.ofSeconds(10)).header("Content-Type", "application/json")
                        .header("Accept", "application/json, text/event-stream")
                        .header("MCP-Protocol-Version", "2025-11-25")
                        .POST(HttpRequest.BodyPublishers.ofString(message)).build(), HttpResponse.BodyHandlers.ofString());
                assertEquals(200, response.statusCode(), response.body());
                if (message.contains("initialize")) {
                    assertTrue(response.body().contains("PocketPlanner"));
                } else {
                    assertTrue(response.body().contains("update_plan_item"));
                    assertFalse(response.body().contains("delete_plan"));
                    assertFalse(response.body().contains("execute_swarm"));
                }
            }
            assertTrue(json(get(application, "/api/state", null)).withArray("plans").isEmpty());
        }
    }

    @Test
    void packagedReactEntryAndAssetsShareTheApiListenerWithoutAnApiFallback() throws Exception {
        try (ApplicationProcess application = start("frontend", temporary.resolve("frontend.sqlite3"), "")) {
            var entry = get(application, "/", null);
            assertEquals(200, entry.statusCode(), "Build frontend/dist before packaging the Java UI candidate");
            String html = new String(entry.body(), StandardCharsets.UTF_8);
            assertTrue(html.contains("PocketPlanner"));
            var script = Pattern.compile("src=\"(/assets/[^\"]+\\.js)\"").matcher(html);
            assertTrue(script.find());
            assertEquals(200, get(application, script.group(1), null).statusCode());
            assertEquals(200, get(application, "/pocketplanner-topbar.svg", null).statusCode());
            assertEquals(404, get(application, "/api/not-a-planner-endpoint", null).statusCode());
            assertEquals(404, get(application, "/example-plan.json", null).statusCode());
            assertEquals(404, get(application, "/auth/callback", null).statusCode());
            assertTrue(json(get(application, "/api/state", null)).withArray("plans").isEmpty());
        }
    }

    @Test
    void missingExplicitDatabaseFailsStartupWithoutCreatingAWorkingStore() throws Exception {
        Path log = temporary.resolve("missing-database.log");
        List<String> command = command("");
        ProcessBuilder builder = new ProcessBuilder(command).directory(temporary.toFile()).redirectErrorStream(true)
                .redirectOutput(log.toFile());
        builder.environment().remove("TESTPLANNER_DB");
        builder.environment().remove("SPRING_APPLICATION_JSON");
        Process process = builder.start();
        try {
            assertTrue(process.waitFor(20, TimeUnit.SECONDS), "Invalid configuration did not fail promptly");
            assertTrue(process.exitValue() != 0);
            assertTrue(Files.readString(log).contains("TESTPLANNER_DB"));
            assertFalse(Files.exists(temporary.resolve("data")));
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
            }
        }
    }

    private ApplicationProcess start(String name, Path database, String auth) throws Exception {
        List<String> command = command(auth);
        command.add("--TESTPLANNER_DB=" + database);
        Path log = temporary.resolve(name + ".log");
        Process process = new ProcessBuilder(command).directory(temporary.toFile()).redirectErrorStream(true)
                .redirectOutput(log.toFile()).start();
        ApplicationProcess application = new ApplicationProcess(process, log);
        try {
            long deadline = System.nanoTime() + Duration.ofSeconds(25).toNanos();
            Pattern port = Pattern.compile("Tomcat started on port ([0-9]+)");
            while (System.nanoTime() < deadline) {
                if (!process.isAlive()) {
                    throw new AssertionError(Files.readString(log));
                }
                var match = port.matcher(Files.readString(log));
                if (match.find()) {
                    application.port = Integer.parseInt(match.group(1));
                    if (get(application, "/health", null).statusCode() == 200) {
                        return application;
                    }
                }
                Thread.sleep(50);
            }
            throw new AssertionError("Packaged application did not become ready: " + Files.readString(log));
        } catch (Throwable failure) {
            application.close();
            throw failure;
        }
    }

    private List<String> command(String auth) {
        return new ArrayList<>(List.of(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-jar", Path.of(System.getProperty("planner.jar")).toAbsolutePath().toString(),
                "--server.port=0", "--server.address=127.0.0.1", "--POCKETHIVE_AUTH_BASE_URL=" + auth));
    }

    private HttpResponse<byte[]> get(ApplicationProcess application, String path, String authorization) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + application.port + path))
                .timeout(Duration.ofSeconds(5)).GET();
        if (authorization != null) {
            request.header("Authorization", authorization);
        }
        return http.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private HttpResponse<byte[]> put(ApplicationProcess application, String path, ObjectNode document) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + application.port + path))
                .timeout(Duration.ofSeconds(10)).header("Authorization", "Bearer phweb_http_admin")
                .header("Content-Type", "application/json").PUT(HttpRequest.BodyPublishers.ofByteArray(WorkspaceJson.encode(document)))
                .build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private ObjectNode json(HttpResponse<byte[]> response) {
        assertEquals(200, response.statusCode(), () -> new String(response.body(), StandardCharsets.UTF_8));
        return WorkspaceJson.parse(response.body());
    }

    private static final class ApplicationProcess implements AutoCloseable {
        private final Process process;
        private final Path log;
        private int port;

        private ApplicationProcess(Process process, Path log) {
            this.process = process;
            this.log = log;
        }

        @Override
        public void close() throws Exception {
            process.destroy();
            if (!process.waitFor(8, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
                throw new AssertionError("Packaged application failed graceful shutdown: " + Files.readString(log));
            }
        }
    }
}
