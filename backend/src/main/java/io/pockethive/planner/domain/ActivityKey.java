package io.pockethive.planner.domain;

/**
 * Responsibility: identify an activity within its plan for factual actions.
 * Must not: merge identities from separate plans.
 * Contract: docs/ARCHITECTURE.md plan-local execution facts.
 */
public record ActivityKey(String planId, String activityId) {}
