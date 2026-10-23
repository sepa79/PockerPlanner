package io.pockethive.planner.mcp;

import io.modelcontextprotocol.server.transport.DefaultServerTransportSecurityValidator;
import io.modelcontextprotocol.server.transport.ServerTransportSecurityException;
import io.modelcontextprotocol.server.transport.ServerTransportSecurityValidator;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Responsibility: constrain MCP Host and Origin to local defaults plus explicit environment entries.
 * Must not: trust forwarded headers, enable CORS or permit global/subdomain wildcards.
 * Contract: docs/MCP.md exact authorities or host-specific :*, 421 Host and 403 Origin failures.
 */
public final class McpSecurity implements ServerTransportSecurityValidator {
    private final ServerTransportSecurityValidator delegate;

    public McpSecurity(String extraHosts, String extraOrigins) {
        List<String> hosts = entries(List.of("localhost", "localhost:*", "127.0.0.1", "127.0.0.1:*",
            "[::1]", "[::1]:*"), extraHosts, false);
        List<String> origins = entries(List.of("http://localhost:*", "http://127.0.0.1:*", "http://[::1]:*"),
            extraOrigins, true);
        delegate = DefaultServerTransportSecurityValidator.builder().allowedHosts(hosts).allowedOrigins(origins).build();
    }

    @Override
    public void validateHeaders(Map<String, List<String>> headers) throws ServerTransportSecurityException {
        List<String> hosts = values(headers, "Host");
        List<String> origins = values(headers, "Origin");
        if (hosts.size() != 1 || !authority(hosts.getFirst(), false)) {
            throw new ServerTransportSecurityException(421, "Invalid Host header");
        }
        if (!origins.isEmpty() && (origins.size() != 1 || !authority(origins.getFirst(), true))) {
            throw new ServerTransportSecurityException(403, "Invalid Origin header");
        }
        delegate.validateHeaders(headers);
    }

    private static List<String> values(Map<String, List<String>> headers, String name) {
        return headers.entrySet().stream().filter(entry -> entry.getKey().equalsIgnoreCase(name))
            .flatMap(entry -> entry.getValue().stream()).toList();
    }

    private static List<String> entries(List<String> defaults, String extra, boolean origin) {
        List<String> result = new ArrayList<>(defaults);
        for (String value : extra.split(",", -1)) {
            String entry = value.strip();
            if (entry.isEmpty()) {
                continue;
            }
            String exact = entry.endsWith(":*") ? entry.substring(0, entry.length() - 1) + "1" : entry;
            if (!authority(exact, origin)) {
                throw new IllegalArgumentException("MCP allowlists require exact authorities or host-specific :* ports");
            }
            result.add(entry);
        }
        return List.copyOf(result);
    }

    private static boolean authority(String value, boolean origin) {
        if (value == null || value.isBlank() || value.contains("*") || !value.equals(value.strip())) {
            return false;
        }
        try {
            URI parsed = URI.create(origin ? value : "http://" + value);
            int port = parsed.getPort();
            return ("http".equals(parsed.getScheme()) || "https".equals(parsed.getScheme()))
                && parsed.getHost() != null && parsed.getRawUserInfo() == null
                && parsed.getRawPath().isEmpty() && parsed.getRawQuery() == null && parsed.getRawFragment() == null
                && (port == -1 || port >= 1 && port <= 65535)
                && parsed.getRawAuthority().equals(parsed.getHost() + (port == -1 ? "" : ":" + port));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }
}
