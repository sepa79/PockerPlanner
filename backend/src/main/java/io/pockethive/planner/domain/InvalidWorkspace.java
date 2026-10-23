package io.pockethive.planner.domain;

/**
 * Responsibility: report rejected workspace or command input.
 * Must not: expose database or authentication diagnostics.
 * Contract: docs/ARCHITECTURE.md data contract; rejection leaves state unchanged.
 */
public final class InvalidWorkspace extends RuntimeException {
    public InvalidWorkspace(String message) {
        super(message);
    }
}
