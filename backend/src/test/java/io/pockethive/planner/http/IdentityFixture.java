package io.pockethive.planner.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

final class IdentityFixture implements AutoCloseable {
    private final HttpServer server;
    final AtomicInteger requests = new AtomicInteger();
    final AtomicInteger redirected = new AtomicInteger();
    final AtomicInteger responseStatus = new AtomicInteger(200);
    final AtomicReference<Boolean> active = new AtomicReference<>(true);

    IdentityFixture() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/auth-service/api/auth/me", this::identity);
        server.createContext("/redirect-target", exchange -> {
            redirected.incrementAndGet();
            reply(exchange, 200, "{\"secret\":\"must-not-reach-client\"}");
        });
        server.start();
    }

    String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/auth-service";
    }

    void reset() {
        requests.set(0);
        redirected.set(0);
        responseStatus.set(200);
        active.set(true);
    }

    private void identity(HttpExchange exchange) throws IOException {
        requests.incrementAndGet();
        int status = responseStatus.get();
        if (status == 302) {
            exchange.getResponseHeaders().set("Location", "/redirect-target");
        }
        if (status != 200) {
            reply(exchange, status, "{\"error\":\"upstream-private-diagnostic\"}");
            return;
        }
        String authorization = exchange.getRequestHeaders().getFirst("Authorization");
        String username = "Bearer phweb_http_admin".equals(authorization) ? "local-admin"
                : "Bearer phweb_http_viewer".equals(authorization) ? "local-viewer" : null;
        if (username == null) {
            reply(exchange, 401, "{\"error\":\"revoked-or-expired-fixture\"}");
            return;
        }
        reply(exchange, 200, "{\"id\":\"a4814293-d61d-4a7f-8b4c-b51721f1600f\",\"username\":\""
                + username + "\",\"displayName\":\"Synthetic user\",\"active\":" + active.get()
                + ",\"authProvider\":\"DEV\",\"grants\":[]}");
    }

    private static void reply(HttpExchange exchange, int status, String text) throws IOException {
        byte[] body = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, body.length);
        try (var output = exchange.getResponseBody()) {
            output.write(body);
        } finally {
            exchange.close();
        }
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
