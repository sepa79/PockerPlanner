package io.pockethive.planner.http;

/**
 * Responsibility: carry a safe explicit HTTP failure from a transport-facing service.
 * Must not: expose credentials, upstream bodies, database paths or exception diagnostics.
 * Contract: docs/ARCHITECTURE.md API error boundaries.
 */
public final class ApiFailure extends RuntimeException {
    private final int status;

    public ApiFailure(int status, String message) {
        super(message);
        this.status = status;
    }

    public int status() {
        return status;
    }
}
