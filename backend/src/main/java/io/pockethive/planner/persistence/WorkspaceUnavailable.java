package io.pockethive.planner.persistence;

/**
 * Responsibility: distinguish unavailable persistence from rejected input.
 * Must not: include operational paths or SQL in public messages.
 * Contract: docs/ARCHITECTURE.md explicit failures without partial saves.
 */
public final class WorkspaceUnavailable extends RuntimeException {
    public WorkspaceUnavailable(Throwable cause) {
        super("Planner workspace is unavailable", cause);
    }
}
