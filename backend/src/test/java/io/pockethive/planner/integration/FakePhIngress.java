package io.pockethive.planner.integration;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class FakePhIngress implements AutoCloseable {
    private final HttpServer server;
    private final ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor();
    private final List<Map<String, String>> requests = new CopyOnWriteArrayList<>();
    private volatile HttpHandler handler = exchange -> reply(exchange, 200, "{}");

    FakePhIngress() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(workers);
        server.createContext("/", exchange -> {
            requests.add(Map.of("path", exchange.getRequestURI().toASCIIString(), "method", exchange.getRequestMethod(),
                "authorization", header(exchange, "Authorization"), "accept", header(exchange, "Accept"),
                "contentType", header(exchange, "Content-Type"),
                "body", new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            try {
                handler.handle(exchange);
            } finally {
                exchange.close();
            }
        });
        server.start();
    }

    String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    PhApiClient client() {
        return new PhApiClient(baseUrl());
    }

    void handle(HttpHandler handler) {
        this.handler = handler;
    }

    void reply(int status, String body) {
        handle(exchange -> reply(exchange, status, body));
    }

    int calls() {
        return requests.size();
    }

    Map<String, String> last() {
        return requests.getLast();
    }

    static void reply(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
        if (bytes.length != 0) {
            exchange.getResponseBody().write(bytes);
        }
    }

    private static String header(HttpExchange exchange, String name) {
        String value = exchange.getRequestHeaders().getFirst(name);
        return value == null ? "" : value;
    }

    @Override
    public void close() {
        server.stop(0);
        workers.shutdownNow();
    }
}
