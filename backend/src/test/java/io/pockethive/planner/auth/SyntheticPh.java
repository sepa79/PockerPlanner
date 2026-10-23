package io.pockethive.planner.auth;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import io.pockethive.planner.domain.WorkspaceJson;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

final class SyntheticPh implements AutoCloseable {
    private final HttpServer server;
    private final Map<String, Integer> statuses = new ConcurrentHashMap<>();
    private final Map<String, String> bodies = new ConcurrentHashMap<>();
    private final Map<String, String> locations = new ConcurrentHashMap<>();
    private final List<Map<String, String>> requests = Collections.synchronizedList(new ArrayList<>());

    SyntheticPh() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/auth-service/", exchange -> {
            String path = exchange.getRequestURI().getPath().substring("/auth-service".length());
            requests.add(Map.of("path", path, "method", exchange.getRequestMethod(),
                "authorization", header(exchange.getRequestHeaders().getFirst("Authorization")),
                "query", header(exchange.getRequestURI().getRawQuery()),
                "contentType", header(exchange.getRequestHeaders().getFirst("Content-Type")),
                "body", new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            if (locations.containsKey(path)) {
                exchange.getResponseHeaders().set("Location", locations.get(path));
            }
            int status = statuses.getOrDefault(path, 404);
            byte[] bytes = bodies.getOrDefault(path, "{}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, status == 204 || bytes.length == 0 ? -1 : bytes.length);
            if (status != 204 && bytes.length != 0) {
                exchange.getResponseBody().write(bytes);
            }
            exchange.close();
        });
        server.start();
    }

    String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/auth-service";
    }

    PhAuthClients clients() {
        return new PhAuthClients(baseUrl(), false);
    }

    void reply(String path, int status, ObjectNode body) {
        reply(path, status, new String(WorkspaceJson.encode(body), StandardCharsets.UTF_8));
    }

    void reply(String path, int status, String body) {
        statuses.put(path, status);
        bodies.put(path, body);
    }

    void redirect(String path, int status, String location) {
        locations.put(path, location);
        reply(path, status, "{}");
    }

    long calls(String path) {
        return requests.stream().filter(request -> path.equals(request.get("path"))).count();
    }

    int calls() {
        return requests.size();
    }

    Map<String, String> lastRequest(String path) {
        return requests.stream().filter(request -> path.equals(request.get("path"))).reduce((first, last) -> last)
            .orElseThrow();
    }

    Map<String, String> form(String path) {
        var values = new LinkedHashMap<String, String>();
        for (String field : lastRequest(path).get("body").split("&")) {
            String[] parts = field.split("=", 2);
            values.put(URLDecoder.decode(parts[0], StandardCharsets.UTF_8),
                parts.length == 1 ? "" : URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
        }
        return values;
    }

    static ObjectNode identity(String username, boolean active) {
        ObjectNode identity = WorkspaceJson.object().put("id", "11111111-1111-1111-1111-111111111111")
            .put("username", username).put("displayName", "Synthetic PH user").put("active", active)
            .put("authProvider", "DEV");
        identity.putArray("grants");
        return identity;
    }

    private static String header(String value) {
        return value == null ? "" : value;
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
