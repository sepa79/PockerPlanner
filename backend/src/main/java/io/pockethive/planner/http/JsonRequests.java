package io.pockethive.planner.http;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.domain.WorkspaceLimits;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;

/**
 * Responsibility: bound HTTP JSON bodies before delegating to the sole workspace codec.
 * Must not: coerce values, validate domain references or implement authorization.
 * Contract: docs/ARCHITECTURE.md one-MiB request and document boundary.
 */
public final class JsonRequests {
    private JsonRequests() {}

    public static ObjectNode read(HttpServletRequest request) {
        if (request.getContentLengthLong() > WorkspaceLimits.MAX_DOCUMENT_BYTES) {
            throw new InvalidWorkspace("Request must not exceed 1 MiB of UTF-8 JSON");
        }
        try {
            return WorkspaceJson.parse(request.getInputStream().readNBytes(WorkspaceLimits.MAX_DOCUMENT_BYTES + 1));
        } catch (IOException exception) {
            throw new InvalidWorkspace("Unable to read request JSON");
        }
    }
}
