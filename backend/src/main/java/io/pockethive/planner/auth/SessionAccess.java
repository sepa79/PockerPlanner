package io.pockethive.planner.auth;

/**
 * Responsibility: carry the current request's safe Planner access decision.
 * Must not: persist identity, cache permissions or validate bearer tokens.
 * Contract: docs/ARCHITECTURE.md anonymous view-only and active local-admin editing.
 */
public record SessionAccess(SessionUser user, boolean canEdit, boolean configured) {}
