package io.pockethive.planner.domain;

/**
 * Responsibility: declare the workspace schema and byte boundary once.
 * Must not: maintain transport-specific alternate limits.
 * Contract: docs/ARCHITECTURE.md one-MiB compact UTF-8 document limit.
 */
public final class WorkspaceLimits {
    public static final int SCHEMA_VERSION = 1;
    public static final int MAX_DOCUMENT_BYTES = 1024 * 1024;

    private WorkspaceLimits() {}
}
