package io.pockethive.planner.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Responsibility: bound single-attempt PH calls to one fixed configured ingress.
 * Must not: authorize, persist, retry, follow redirects or expose upstream diagnostics.
 * Contract: docs/POCKETHIVE_INTEGRATION.md five-second total exchange and eight-MiB strict JSON.
 */
@Component
public final class PhApiClient {
    private static final long TIMEOUT_NANOS = TimeUnit.SECONDS.toNanos(5);
    private final Semaphore capacity = new Semaphore(64);
    private final String baseUrl;

    public PhApiClient(@Value("${POCKETHIVE_BASE_URL:}") String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public JsonNode get(String path, String authorization) {
        return request(path, authorization, null);
    }

    public JsonNode post(String path, String authorization, ObjectNode body) {
        if (body == null) {
            throw PhJson.invalid();
        }
        return request(path, authorization, body);
    }

    private JsonNode request(String path, String authorization, ObjectNode body) {
        long started = System.nanoTime();
        URI target = PhUrls.ingress(PhUrls.base(baseUrl, "POCKETHIVE_BASE_URL"), path);
        if (authorization == null || authorization.isEmpty()
                || authorization.chars().anyMatch(character -> character < 32 || character > 126)) {
            throw PhJson.invalid();
        }
        if (!capacity.tryAcquire()) {
            throw PhJson.invalid();
        }
        PhHttpExchange exchange = new PhHttpExchange();
        FutureTask<JsonNode> result = new FutureTask<>(() -> {
            try (exchange) {
                return exchange.execute(target, authorization, body == null ? null : PhJson.encode(body));
            } catch (IOException exception) {
                throw PhJson.invalid();
            } finally {
                capacity.release();
            }
        });
        Thread worker = Thread.ofVirtual().name("planner-ph-exchange").start(result);
        try {
            long remaining = TIMEOUT_NANOS - (System.nanoTime() - started);
            if (remaining <= 0) {
                throw new TimeoutException();
            }
            return result.get(remaining, TimeUnit.NANOSECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw PhJson.invalid();
        } catch (TimeoutException exception) {
            throw PhJson.invalid();
        } catch (ExecutionException exception) {
            if (exception.getCause() instanceof io.pockethive.planner.http.ApiFailure failure) {
                throw failure;
            }
            throw PhJson.invalid();
        } finally {
            exchange.close();
            worker.interrupt();
        }
    }
}
