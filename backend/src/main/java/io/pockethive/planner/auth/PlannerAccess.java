package io.pockethive.planner.auth;

import io.pockethive.auth.client.AuthServiceClientException;
import io.pockethive.auth.contract.AuthenticatedUserDto;
import io.pockethive.planner.http.ApiFailure;
import org.springframework.stereotype.Component;

/**
 * Responsibility: decide Planner access using freshly verified PH identity for each request.
 * Must not: implement OAuth, cache authorization or trust unverified token claims.
 * Contract: docs/ARCHITECTURE.md authentication and docs/POCKET_FAMILY_UNIFICATION.md.
 */
@Component
public final class PlannerAccess {
    private final PhAuthClients clients;

    public PlannerAccess(PhAuthClients clients) {
        this.clients = clients;
    }

    public SessionAccess access(String authorization) {
        if (authorization == null) {
            return new SessionAccess(null, false, clients.configured());
        }
        PocketBearer.require(authorization);
        AuthenticatedUserDto user;
        try {
            user = clients.identity().me(authorization);
        } catch (AuthServiceClientException failure) {
            int status = failure.getStatusCode();
            if (status == 401 || status == 403) {
                throw new ApiFailure(401, "Invalid or inactive PocketHive session.");
            }
            throw new ApiFailure(503, "PocketHive authentication is unavailable.");
        }
        if (user == null) {
            throw new ApiFailure(503, "PocketHive returned an invalid identity response.");
        }
        if (!user.active()) {
            throw new ApiFailure(401, "Invalid or inactive PocketHive session.");
        }
        return new SessionAccess(new SessionUser(user.username(), user.displayName()),
            "local-admin".equals(user.username()), true);
    }

    public void requireEditor(String authorization) {
        SessionAccess result = access(authorization);
        if (!result.canEdit()) {
            throw new ApiFailure(result.user() == null ? 401 : 403,
                "An active PocketHive local-admin session is required to edit plans.");
        }
    }

    public void requireSession(String authorization) {
        if (access(authorization).user() == null) {
            throw new ApiFailure(401, "An active PocketHive session is required.");
        }
    }
}
