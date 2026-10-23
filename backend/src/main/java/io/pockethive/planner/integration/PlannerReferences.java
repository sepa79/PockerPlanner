package io.pockethive.planner.integration;

import io.pockethive.planner.http.ApiFailure;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

/**
 * Responsibility: derive stable instance-scoped Plan and Activity references.
 * Must not: use names, stream membership, shortened digests or normalized IDs as identity.
 * Contract: docs/POCKETHIVE_INTEGRATION.md literal testPlan and full SHA-256 Activity tag.
 */
final class PlannerReferences {
    private PlannerReferences() {}

    static String instance(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_-]{1,40}")) {
            throw new ApiFailure(503, "Configure a stable POCKETPLANNER_INSTANCE_ID (1–40 ASCII letters, digits, _ or -).");
        }
        return value;
    }

    static String testPlan(String instance, String plan) {
        return "pp:" + instance + ":" + plan;
    }

    static String tag(String instance, String plan, String activity) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(PhJson.identity(instance, plan, activity));
            return "pp.activity:" + Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required by Java", exception);
        }
    }
}
