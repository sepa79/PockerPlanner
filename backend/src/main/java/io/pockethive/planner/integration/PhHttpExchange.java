package io.pockethive.planner.integration;

import com.fasterxml.jackson.databind.JsonNode;
import io.pockethive.planner.http.ApiFailure;
import java.io.IOException;
import java.net.URI;
import org.apache.hc.client5.http.classic.methods.HttpUriRequestBase;
import org.apache.hc.client5.http.config.ConnectionConfig;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.CloseableHttpResponse;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http.io.entity.ByteArrayEntity;
import org.apache.hc.core5.io.CloseMode;
import org.apache.hc.core5.util.Timeout;

/**
 * Responsibility: perform one bounded HTTP(S) exchange through maintained Apache HttpClient.
 * Must not: implement HTTP/TLS, use ambient credentials, redirect, retry or drain rejected bodies.
 * Contract: operator-selected PH ingress; cancellation immediately closes request and response.
 */
final class PhHttpExchange implements AutoCloseable {
    private final CloseableHttpClient client = HttpClients.custom()
        .disableAutomaticRetries().disableRedirectHandling().disableCookieManagement()
        .disableAuthCaching().disableContentCompression()
        .setConnectionManager(PoolingHttpClientConnectionManagerBuilder.create()
            .setMaxConnTotal(1).setMaxConnPerRoute(1)
            .setDefaultConnectionConfig(ConnectionConfig.custom().setConnectTimeout(Timeout.ofSeconds(5))
                .setSocketTimeout(Timeout.ofSeconds(5)).build()).build())
        .setDefaultRequestConfig(RequestConfig.custom().setAuthenticationEnabled(false)
            .setConnectionRequestTimeout(Timeout.ofSeconds(5)).setResponseTimeout(Timeout.ofSeconds(5))
            .setHardCancellationEnabled(true).build())
        .build();
    private volatile HttpUriRequestBase request;
    private volatile CloseableHttpResponse response;
    private volatile boolean closed;

    JsonNode execute(URI target, String authorization, byte[] body) throws IOException {
        request = new HttpUriRequestBase(body == null ? "GET" : "POST", target);
        request.setHeader("Accept", "application/json");
        request.setHeader("Authorization", authorization);
        if (body != null) {
            request.setEntity(new ByteArrayEntity(body, ContentType.APPLICATION_JSON));
        }
        if (closed) {
            throw PhJson.invalid();
        }
        response = CloseableHttpResponse.adapt(client.executeOpen(null, request, null));
        if (closed) {
            response.close(CloseMode.IMMEDIATE);
            throw PhJson.invalid();
        }
        int status = response.getCode();
        if (status < 200 || status >= 300) {
            throw new ApiFailure(switch (status) {
                case 400, 401, 403, 404, 409 -> status;
                default -> 503;
            }, "PocketHive request failed; no automatic retry.");
        }
        var entity = response.getEntity();
        if (entity == null || entity.getContentLength() > PhJson.MAX_BYTES) {
            throw PhJson.invalid();
        }
        return PhJson.parse(entity.getContent().readNBytes(PhJson.MAX_BYTES + 1));
    }

    @Override
    public void close() {
        closed = true;
        HttpUriRequestBase activeRequest = request;
        if (activeRequest != null) {
            activeRequest.cancel();
        }
        CloseableHttpResponse activeResponse = response;
        if (activeResponse != null) {
            activeResponse.close(CloseMode.IMMEDIATE);
        }
        client.close(CloseMode.IMMEDIATE);
    }
}
