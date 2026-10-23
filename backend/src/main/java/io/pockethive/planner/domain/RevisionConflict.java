package io.pockethive.planner.domain;

/**
 * Responsibility: distinguish stale writes from invalid input.
 * Must not: rebase or replay a rejected command.
 * Contract: docs/ARCHITECTURE.md optimistic revision checks.
 */
public final class RevisionConflict extends RuntimeException {
    public RevisionConflict() {
        super("Workspace changed in another session. Reload and try again.");
    }
}
