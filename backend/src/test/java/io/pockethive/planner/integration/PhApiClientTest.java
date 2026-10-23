package io.pockethive.planner.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.pockethive.planner.http.ApiFailure;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class PhApiClientTest {
    private static final String PATH = "/orchestrator/api/test";

    @Test
    void getAndPostForwardOnlyTheCallerSessionAndKeepExactEncodedPath() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            ph.reply(200, "{\"answer\":42}");
            assertEquals(42, ph.client().get(PATH + "/swarm%2Fone?runId=old%20run", "Bearer synthetic").get("answer").intValue());
            assertEquals(PATH + "/swarm%2Fone?runId=old%20run", ph.last().get("path"));
            assertEquals("GET", ph.last().get("method"));
            assertEquals("Bearer synthetic", ph.last().get("authorization"));
            assertEquals("application/json", ph.last().get("accept"));
            assertEquals("", ph.last().get("body"));
            var body = PhJson.object().put("idempotencyKey", "synthetic-key").put("unicode", "ą🐝");
            ph.client().post(PATH, "Bearer viewer", body);
            assertEquals("POST", ph.last().get("method"));
            assertEquals("Bearer viewer", ph.last().get("authorization"));
            assertTrue(ph.last().get("contentType").startsWith("application/json"));
            assertEquals(body, PhJson.parse(ph.last().get("body").getBytes(StandardCharsets.UTF_8)));
            assertEquals(2, ph.calls());
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 401, 403, 404, 409, 429, 500, 502, 503, 504})
    void mapsOnlyDeclaredUpstreamStatusesWithoutDiagnosticsOrRetries(int status) throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            ph.reply(status, "secret diagnostic with Bearer synthetic");
            ApiFailure failure = assertThrows(ApiFailure.class,
                () -> ph.client().post(PATH, "Bearer synthetic", PhJson.object()));
            assertEquals(status == 400 || status == 401 || status == 403 || status == 404 || status == 409 ? status : 503,
                failure.status());
            assertFalse(failure.getMessage().contains("secret"));
            assertFalse(failure.getMessage().contains("synthetic"));
            assertFalse(failure.getMessage().contains(ph.baseUrl()));
            assertNull(failure.getCause());
            assertEquals(1, ph.calls());
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {301, 302, 303, 307, 308})
    void neverFollowsRedirectsOrForwardsTheSessionToAnotherDestination(int status) throws Exception {
        try (FakePhIngress ph = new FakePhIngress(); FakePhIngress destination = new FakePhIngress()) {
            ph.handle(exchange -> {
                exchange.getResponseHeaders().set("Location", destination.baseUrl() + PATH);
                FakePhIngress.reply(exchange, status, "{}");
            });
            assertEquals(503, assertThrows(ApiFailure.class, () -> ph.client().get(PATH, "Bearer synthetic")).status());
            assertEquals(1, ph.calls());
            assertEquals(0, destination.calls());
        }
    }

    @Test
    void droppedConnectionsDoNotRepeatGetOrPostIncludingAnUncertainCommand() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            ph.handle(exchange -> exchange.close());
            PhApiClient client = ph.client();
            assertEquals(503, assertThrows(ApiFailure.class, () -> client.get(PATH, "Bearer synthetic")).status());
            assertEquals(1, ph.calls());
            assertEquals(503, assertThrows(ApiFailure.class,
                () -> client.post(PATH, "Bearer synthetic", PhJson.object().put("idempotencyKey", "one"))).status());
            assertEquals(2, ph.calls());
        }
    }

    @Test
    void malformedTruncatedAndWrongShapeResponsesNeverBecomeEmptySuccess() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            PhApiClient client = ph.client();
            for (String body : new String[]{"", "{}{}", "{\"x\":1,\"x\":2}", "true", "{\"x\":\"\\ud800\"}"}) {
                ph.reply(200, body);
                assertEquals(503, assertThrows(ApiFailure.class, () -> client.get(PATH, "Bearer synthetic")).status());
            }
            ph.handle(exchange -> {
                exchange.sendResponseHeaders(200, 100);
                exchange.getResponseBody().write("{}".getBytes(StandardCharsets.UTF_8));
            });
            assertEquals(503, assertThrows(ApiFailure.class, () -> client.get(PATH, "Bearer synthetic")).status());
            ph.handle(exchange -> {
                exchange.sendResponseHeaders(200, 9);
                exchange.getResponseBody().write(new byte[]{'{', '"', 'x', '"', ':', '"', (byte) 0xc3, '"', '}'});
            });
            assertEquals(503, assertThrows(ApiFailure.class, () -> client.get(PATH, "Bearer synthetic")).status());
        }
    }

    @Test
    void exactlyEightMiBIsAcceptedAndFixedOrStreamedOversizeBodiesAreRejectedWithoutDraining() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            String full = "[\"" + "x".repeat(PhJson.MAX_BYTES - 4) + "\"]";
            ph.reply(200, full);
            PhApiClient client = ph.client();
            assertEquals(PhJson.MAX_BYTES - 4, client.get(PATH, "Bearer synthetic").get(0).textValue().length());
            ph.handle(exchange -> {
                exchange.sendResponseHeaders(200, PhJson.MAX_BYTES + 1L);
                sleep(10000);
            });
            long started = System.nanoTime();
            assertThrows(ApiFailure.class, () -> client.get(PATH, "Bearer synthetic"));
            assertTrue(Duration.ofNanos(System.nanoTime() - started).toMillis() < 3000);
            ph.handle(exchange -> {
                exchange.sendResponseHeaders(200, 0);
                exchange.getResponseBody().write(new byte[PhJson.MAX_BYTES + 1]);
                exchange.getResponseBody().flush();
                sleep(10000);
            });
            started = System.nanoTime();
            assertThrows(ApiFailure.class, () -> client.get(PATH, "Bearer synthetic"));
            assertTrue(Duration.ofNanos(System.nanoTime() - started).toMillis() < 3000);
            assertEquals(3, ph.calls());
        }
    }

    @Test
    void fiveSecondsIncludesDelayedHeadersAndContinuouslyStreamedBody() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            ph.handle(exchange -> {
                sleep(2200);
                exchange.sendResponseHeaders(200, 0);
                for (int count = 0; count < 100; count++) {
                    exchange.getResponseBody().write(' ');
                    exchange.getResponseBody().flush();
                    sleep(100);
                }
            });
            PhApiClient client = ph.client();
            long started = System.nanoTime();
            assertEquals(503, assertThrows(ApiFailure.class, () -> client.get(PATH, "Bearer synthetic")).status());
            long elapsed = Duration.ofNanos(System.nanoTime() - started).toMillis();
            assertTrue(elapsed >= 4500 && elapsed < 6000, "Total elapsed milliseconds: " + elapsed);
            assertEquals(1, ph.calls());
            ph.reply(200, "[]");
            assertEquals(0, client.get(PATH, "Bearer synthetic").size());
        }
    }

    @Test
    void interruptCancelsTheExchangeAndRetainsTheCallingThreadInterrupt() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            CountDownLatch entered = new CountDownLatch(1);
            ph.handle(exchange -> {
                entered.countDown();
                sleep(10000);
            });
            AtomicReference<Throwable> failure = new AtomicReference<>();
            AtomicReference<Boolean> interrupted = new AtomicReference<>();
            Thread caller = Thread.ofVirtual().start(() -> {
                try {
                    ph.client().get(PATH, "Bearer synthetic");
                } catch (Throwable exception) {
                    failure.set(exception);
                    interrupted.set(Thread.currentThread().isInterrupted());
                }
            });
            assertTrue(entered.await(3, TimeUnit.SECONDS));
            caller.interrupt();
            caller.join(2000);
            assertFalse(caller.isAlive());
            assertTrue(failure.get() instanceof ApiFailure);
            assertEquals(true, interrupted.get());
            assertEquals(1, ph.calls());
        }
    }

    @Test
    void invalidConfigurationPathsAuthorizationAndBodiesNeverReachTheNetwork() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            for (String base : new String[]{"", "file:///etc/passwd", "https://user:pass@ph", "https://ph?query", "https://ph#fragment"}) {
                PhApiClient client = new PhApiClient(base);
                assertEquals(503, assertThrows(ApiFailure.class, () -> client.get(PATH, "Bearer synthetic")).status());
            }
            PhApiClient client = ph.client();
            for (String path : new String[]{"https://evil.example" + PATH, "//evil.example" + PATH, "/auth-service/identity",
                    "/orchestrator/api/../outside", PATH + "#fragment", PATH + "\r\nInjected: header"}) {
                assertEquals(503, assertThrows(ApiFailure.class, () -> client.get(path, "Bearer synthetic")).status());
            }
            assertThrows(ApiFailure.class, () -> client.get(PATH, "Bearer token\r\nInjected: header"));
            assertThrows(ApiFailure.class, () -> client.get(PATH, null));
            assertThrows(ApiFailure.class, () -> client.post(PATH, "Bearer synthetic", null));
            assertThrows(ApiFailure.class, () -> client.post(PATH, "Bearer synthetic", PhJson.object().put("x", Double.NaN)));
            assertEquals(0, ph.calls());
        }
    }

    private static void sleep(long milliseconds) throws IOException {
        try {
            Thread.sleep(milliseconds);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IOException("Synthetic responder interrupted");
        }
    }
}
