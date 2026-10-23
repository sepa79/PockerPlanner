package io.pockethive.planner.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

final class RuntimeHttpFixture implements AutoCloseable {
    private final HttpServer server;
    final List<String> requests = new CopyOnWriteArrayList<>();
    final AtomicInteger status = new AtomicInteger(200);
    volatile String runs = "[]";
    volatile String runtimes = "[]";
    volatile String operationRun = "run-1";

    RuntimeHttpFixture() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::respond);
        server.start();
    }

    String origin() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private void respond(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        String authorization = exchange.getRequestHeaders().getFirst("Authorization");
        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        requests.add(exchange.getRequestMethod() + " " + exchange.getRequestURI() + " " + authorization + " " + body);
        if (path.equals("/auth-service/api/auth/me")) {
            boolean admin = "Bearer phweb_http_admin".equals(authorization);
            if (!admin && !"Bearer phweb_http_viewer".equals(authorization)) {
                reply(exchange, 401, "{\"error\":\"revoked\"}");
                return;
            }
            reply(exchange, 200, "{\"id\":\"a4814293-d61d-4a7f-8b4c-b51721f1600f\",\"username\":\""
                    + (admin ? "local-admin" : "local-viewer") + "\",\"displayName\":\"Synthetic user\",\"active\":true,"
                    + "\"authProvider\":\"DEV\",\"grants\":[]}");
        } else if (status.get() != 200) {
            reply(exchange, status.get(), "{\"error\":\"private PH diagnostic\"}");
        } else if (path.endsWith("/journal/swarm/runs")) {
            reply(exchange, 200, runs);
        } else if (path.equals("/orchestrator/api/swarms")) {
            reply(exchange, 200, runtimes);
        } else if (path.equals("/orchestrator/api/access/swarms")) {
            reply(exchange, 200, "{\"swarms\":[{\"swarmId\":\"qa\",\"canRun\":true,\"canManage\":false}]}");
        } else if (path.endsWith("/operations/op")) {
            reply(exchange, 200, "{\"swarmId\":\"qa\",\"correlationId\":\"op\",\"type\":\"START\",\"state\":\"SUCCEEDED\","
                    + "\"runtime\":{\"runId\":\"" + operationRun + "\"}}");
        } else if (path.endsWith("/stop")) {
            reply(exchange, 403, "{\"error\":\"PH denies manage permission\"}");
        } else if (path.endsWith("/start")) {
            reply(exchange, 202, "{\"correlationId\":\"op\",\"idempotencyKey\":\"same-key\",\"timeoutMs\":180000}");
        } else {
            reply(exchange, 404, "{}");
        }
    }

    private static void reply(HttpExchange exchange, int status, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        } finally {
            exchange.close();
        }
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
