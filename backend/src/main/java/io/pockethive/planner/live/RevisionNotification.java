package io.pockethive.planner.live;

import java.math.BigInteger;
import java.util.Map;

/**
 * Responsibility: represent one safe, immutable committed-revision observation.
 * Must not: carry workspace contents, credentials, diagnostics or event history.
 * Contract: docs/ARCHITECTURE.md revision data {revision} and unavailable data {}.
 */
record RevisionNotification(BigInteger revision) {
    RevisionNotification {
        if (revision != null && revision.signum() < 0) {
            throw new IllegalArgumentException("Revision must not be negative");
        }
    }

    static RevisionNotification unavailable() {
        return new RevisionNotification(null);
    }

    String event() {
        return revision == null ? "unavailable" : "revision";
    }

    Map<String, BigInteger> data() {
        return revision == null ? Map.of() : Map.of("revision", revision);
    }
}
