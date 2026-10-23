package io.pockethive.planner.mcp;

import io.modelcontextprotocol.server.transport.ServerTransportSecurityException;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.domain.WorkspaceLimits;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Responsibility: reject unsafe headers and bound/strictly decode bytes before the SDK reads them.
 * Must not: dispatch MCP messages, authorize tools or expose parser diagnostics.
 * Contract: docs/MCP.md one-MiB UTF-8 requests; the official SDK alone owns the protocol.
 */
public final class McpBoundaryFilter extends OncePerRequestFilter {
    private final McpSecurity security;

    public McpBoundaryFilter(McpSecurity security) {
        this.security = security;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Map<String, List<String>> headers = new LinkedHashMap<>();
        for (String name : Collections.list(request.getHeaderNames())) {
            headers.put(name, Collections.list(request.getHeaders(name)));
        }
        try {
            security.validateHeaders(headers);
        } catch (ServerTransportSecurityException failure) {
            reject(response, failure.getStatusCode(), failure.getMessage());
            return;
        }
        if (Collections.list(request.getHeaders("Authorization")).size() > 1) {
            reject(response, 400, "Invalid Authorization header");
            return;
        }
        if (!request.getMethod().equals("POST")) {
            chain.doFilter(request, response);
            return;
        }
        if (request.getContentLengthLong() > WorkspaceLimits.MAX_DOCUMENT_BYTES) {
            reject(response, 413, "INVALID_INPUT: MCP request must not exceed 1 MiB");
            return;
        }
        byte[] body = request.getInputStream().readNBytes(WorkspaceLimits.MAX_DOCUMENT_BYTES + 1);
        if (body.length > WorkspaceLimits.MAX_DOCUMENT_BYTES) {
            reject(response, 413, "INVALID_INPUT: MCP request must not exceed 1 MiB");
            return;
        }
        try {
            WorkspaceJson.parse(body);
        } catch (InvalidWorkspace failure) {
            reject(response, 400, "INVALID_INPUT: MCP request must contain one strict UTF-8 JSON object");
            return;
        }
        chain.doFilter(new McpBodyRequest(request, body), response);
    }

    private static void reject(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getOutputStream().write(WorkspaceJson.encode(WorkspaceJson.object().put("error", message)));
    }
}
