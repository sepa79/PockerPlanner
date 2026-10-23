package io.pockethive.planner.mcp;

import com.sun.net.httpserver.HttpServer;
import io.pockethive.planner.domain.WorkspaceJson;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

final class McpIdentityFixture implements AutoCloseable {
    static final String ADMIN = "Bearer phweb_mcp_admin";
    static final String VIEWER = "Bearer phweb_mcp_viewer";
    private final HttpServer server;
    final ConcurrentLinkedQueue<String> authorizations = new ConcurrentLinkedQueue<>();
    final AtomicInteger status = new AtomicInteger(200);
    final AtomicBoolean active = new AtomicBoolean(true);

    McpIdentityFixture() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/auth-service/api/auth/me", exchange -> {
            String authorization = exchange.getRequestHeaders().getFirst("Authorization");
            authorizations.add(authorization == null ? "" : authorization);
            int responseStatus = status.get();
            String username = ADMIN.equals(authorization) ? "local-admin" : VIEWER.equals(authorization) ? "viewer" : null;
            byte[] body;
            if (responseStatus == 200 && username != null) {
                var identity = WorkspaceJson.object().put("id", "11111111-1111-1111-1111-111111111111")
                    .put("username", username).put("displayName", "Synthetic " + username).put("active", active.get())
                    .put("authProvider", "DEV");
                identity.putArray("grants");
                body = WorkspaceJson.encode(identity);
            } else {
                if (responseStatus == 200) {
                    responseStatus = 401;
                }
                body = "{\"error\":\"private-upstream-diagnostic\"}".getBytes(StandardCharsets.UTF_8);
            }
            if (responseStatus == 302) {
                exchange.getResponseHeaders().set("Location", "/must-not-follow");
            }
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(responseStatus, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
    }

    String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/auth-service";
    }

    void reset() {
        authorizations.clear();
        status.set(200);
        active.set(true);
    }

    List<String> headers() {
        return List.copyOf(authorizations);
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
