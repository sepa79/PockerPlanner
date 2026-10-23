package io.pockethive.planner.live;

/**
 * Responsibility: report an explicit safe live-service lifecycle or capacity failure.
 * Must not: expose persistence diagnostics or decide HTTP authorization policy.
 * Contract: docs/ARCHITECTURE.md bounded subscriptions with retryable unavailability.
 */
public final class LiveUnavailable extends RuntimeException {
    LiveUnavailable(String message) {
        super(message);
    }
}
