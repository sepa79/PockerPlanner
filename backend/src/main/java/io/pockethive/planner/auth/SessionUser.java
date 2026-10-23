package io.pockethive.planner.auth;

/**
 * Responsibility: expose only PH identity display fields to the Planner browser.
 * Must not: expose grants, credentials or issue product permissions.
 * Contract: docs/ARCHITECTURE.md public session access projection.
 */
public record SessionUser(String username, String displayName) {}
