package io.pockethive.planner.http;

import io.pockethive.planner.metadata.VersionInfo;
import io.pockethive.planner.persistence.WorkspaceStore;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Responsibility: map public version and health requests to their owners.
 * Must not: mutate plans, probe PH availability or choose application versions.
 * Contract: docs/ARCHITECTURE.md /api/info and workspace-backed /health.
 */
@RestController
public final class MetadataController {
    private final VersionInfo info;
    private final WorkspaceStore store;

    public MetadataController(VersionInfo info, WorkspaceStore store) {
        this.info = info;
        this.store = store;
    }

    @GetMapping("/api/info")
    public VersionInfo info() {
        return info;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        store.readRevision();
        return Map.of("status", "ok");
    }
}
