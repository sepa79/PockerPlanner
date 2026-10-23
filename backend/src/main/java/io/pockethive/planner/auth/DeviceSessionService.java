package io.pockethive.planner.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.auth.client.AuthServiceClientException;
import io.pockethive.auth.client.DeviceAuthException;
import io.pockethive.auth.contract.DeviceAuthorizationDto;
import io.pockethive.auth.contract.DeviceTokenDto;
import io.pockethive.planner.http.ApiFailure;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/**
 * Responsibility: adapt strict Planner session requests to the shared PH device client.
 * Must not: implement protocol HTTP, retain login transactions, loop polling or grant access.
 * Contract: docs/POCKET_FAMILY_UNIFICATION.md callback-free shared PH device authentication.
 */
@Component
public final class DeviceSessionService {
    private final PhAuthClients clients;

    public DeviceSessionService(PhAuthClients clients) {
        this.clients = clients;
    }

    public DeviceAuthorizationDto start(ObjectNode body) {
        requireEmpty(body);
        return request(() -> clients.device().start());
    }

    public DeviceTokenDto poll(ObjectNode body) {
        JsonNode code = body == null ? null : body.get("deviceCode");
        if (body == null || body.size() != 1 || code == null || !code.isTextual()
            || code.textValue().isBlank() || code.textValue().length() > 4096) {
            throw new ApiFailure(400, "Exactly one non-blank deviceCode string of at most 4096 characters is required.");
        }
        return request(() -> clients.device().poll(code.textValue()));
    }

    public Map<String, String> logout(String authorization, ObjectNode body) {
        requireEmpty(body);
        String token = PocketBearer.requireBrowser(authorization);
        return request(() -> {
            String logoutUrl = clients.device().configuration().logoutUri().toString();
            clients.device().revoke(token);
            return Map.of("logoutUrl", logoutUrl);
        });
    }

    private static void requireEmpty(ObjectNode body) {
        if (body == null || !body.isEmpty()) {
            throw new ApiFailure(400, "An empty JSON object is required.");
        }
    }

    private <Result> Result request(Supplier<Result> action) {
        try {
            return action.get();
        } catch (DeviceAuthException failure) {
            throw new ApiFailure(400, failure.getError());
        } catch (AuthServiceClientException failure) {
            throw new ApiFailure(503, "PocketHive authentication is unavailable.");
        }
    }
}
