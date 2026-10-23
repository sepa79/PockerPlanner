package io.pockethive.planner.metadata;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Responsibility: expose application metadata from the single VERSION resource.
 * Must not: infer a version from Maven, tags or the workspace.
 * Contract: docs/ARCHITECTURE.md application version; invalid metadata fails startup.
 */
public record VersionInfo(String name, String version) {
    public static VersionInfo load() {
        try (var input = VersionInfo.class.getResourceAsStream("/VERSION")) {
            if (input == null) {
                throw new IllegalStateException("VERSION is required");
            }
            String value = new String(input.readNBytes(256), StandardCharsets.UTF_8).strip();
            if (!value.matches("[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?") || input.read() != -1) {
                throw new IllegalStateException("VERSION must contain an application version");
            }
            return new VersionInfo("PocketPlanner", value);
        } catch (IOException exception) {
            throw new IllegalStateException("VERSION is unavailable", exception);
        }
    }
}
