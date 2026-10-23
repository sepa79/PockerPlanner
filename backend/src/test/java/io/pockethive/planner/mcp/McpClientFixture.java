package io.pockethive.planner.mcp;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;

final class McpClientFixture implements AutoCloseable {
    final AtomicReference<String> authorization;
    final McpSyncClient client;

    McpClientFixture(String baseUrl, String authorization) {
        this.authorization = new AtomicReference<>(authorization);
        var transport = HttpClientStreamableHttpTransport.builder(baseUrl).endpoint("/mcp")
            .jsonMapper(McpConfiguration.protocolMapper()).openConnectionOnStartup(false)
            .httpRequestCustomizer((builder, method, uri, body, context) -> {
                String current = this.authorization.get();
                if (current != null) {
                    builder.header("Authorization", current);
                }
            }).build();
        client = McpClient.sync(transport).requestTimeout(Duration.ofSeconds(10))
            .build();
    }

    @Override
    public void close() {
        client.closeGracefully();
    }
}
