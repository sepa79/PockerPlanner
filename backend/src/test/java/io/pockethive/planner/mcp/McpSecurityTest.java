package io.pockethive.planner.mcp;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.modelcontextprotocol.server.transport.ServerTransportSecurityException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class McpSecurityTest {
    @Test
    void defaultsAreLocalAndConfiguredPatternsAreOnlyExactOrHostSpecificPorts() {
        var security = new McpSecurity("planner.test:8443, exact.test:*, [2001:db8::1]:*", "https://client.test:*,https://exact.test");
        for (String host : List.of("localhost", "127.0.0.1:8765", "[::1]:8765", "planner.test:8443", "exact.test:123", "[2001:db8::1]:443")) {
            assertDoesNotThrow(() -> security.validateHeaders(Map.of("hOsT", List.of(host))));
        }
        for (String origin : List.of("http://localhost:123", "http://[::1]:123", "https://client.test:123", "https://exact.test")) {
            assertDoesNotThrow(() -> security.validateHeaders(Map.of("Host", List.of("localhost"), "Origin", List.of(origin))));
        }
        for (String host : List.of("evil.test", "planner.test:443", "localhost.evil.test:123", "localhost:123/path", "localhost:", "localhost:65536", "localhost:0", "localhost:12@evil.test", "localhost:123,evil.test")) {
            assertEquals(421, assertThrows(ServerTransportSecurityException.class,
                () -> security.validateHeaders(Map.of("Host", List.of(host)))).getStatusCode());
        }
        for (String origin : List.of("null", "", "https://localhost:123", "http://localhost:123/path", "http://localhost:123.evil.test", "http://localhost@evil.test:123")) {
            assertEquals(403, assertThrows(ServerTransportSecurityException.class,
                () -> security.validateHeaders(Map.of("Host", List.of("localhost"), "Origin", List.of(origin)))).getStatusCode());
        }
        assertEquals(421, assertThrows(ServerTransportSecurityException.class, () -> security.validateHeaders(Map.of())).getStatusCode());
        assertEquals(421, assertThrows(ServerTransportSecurityException.class,
            () -> security.validateHeaders(Map.of("Host", List.of("localhost", "evil.test")))).getStatusCode());
        assertEquals(403, assertThrows(ServerTransportSecurityException.class,
            () -> security.validateHeaders(Map.of("Host", List.of("localhost"), "Origin", List.of("http://localhost", "http://evil.test")))).getStatusCode());
    }

    @Test
    void malformedAndGlobalWildcardConfigurationFailsStartup() {
        for (String host : List.of("*", "*:123", "*.test:*", "localhost:*:123", "http://localhost", "user@localhost", "localhost/path", "localhost:abc")) {
            assertThrows(IllegalArgumentException.class, () -> new McpSecurity(host, ""), host);
        }
        for (String origin : List.of("*", "http://*", "https://*.test:*", "https://client.test/path", "https://client.test?query", "file://localhost", "https://user@client.test", "null")) {
            assertThrows(IllegalArgumentException.class, () -> new McpSecurity("", origin), origin);
        }
    }
}
