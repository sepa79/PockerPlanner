package io.pockethive.planner.auth;

import io.pockethive.auth.contract.PocketHiveBrowserAuth;
import io.pockethive.planner.http.ApiFailure;

/**
 * Responsibility: reject malformed bearer headers and non-browser revocation tokens.
 * Must not: infer identity, decode claims or authorize Planner mutations.
 * Contract: docs/ARCHITECTURE.md authentication and shared PH browser token contract.
 */
final class PocketBearer {
    private PocketBearer() {}

    static String require(String authorization) {
        if (authorization == null || authorization.length() > 16_007
            || !authorization.startsWith("Bearer ")
            || !authorization.substring(7).matches("[A-Za-z0-9._~-]{1,16000}")) {
            throw new ApiFailure(401, "A valid PocketHive bearer session is required.");
        }
        return authorization.substring(7);
    }

    static String requireBrowser(String authorization) {
        String token = require(authorization);
        if (!token.startsWith(PocketHiveBrowserAuth.TOKEN_PREFIX)
            || token.length() == PocketHiveBrowserAuth.TOKEN_PREFIX.length()) {
            throw new ApiFailure(401, "A PocketHive browser session is required to sign out.");
        }
        return token;
    }
}
