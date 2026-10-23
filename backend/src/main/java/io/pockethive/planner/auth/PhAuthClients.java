package io.pockethive.planner.auth;

import io.pockethive.auth.client.AuthServiceClient;
import io.pockethive.auth.client.DeviceAuthClient;
import io.pockethive.auth.contract.PocketHiveDeviceAuth;
import io.pockethive.planner.http.ApiFailure;
import java.net.URI;
import java.time.Duration;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Responsibility: construct shared PH clients from explicit ingress and public-endpoint transport settings.
 * Must not: implement auth transport, choose alternate providers or grant product access.
 * Contract: docs/POCKET_FAMILY_UNIFICATION.md shared JVM identity boundary.
 */
@Component
public final class PhAuthClients {
    private final AuthServiceClient identity;
    private final DeviceAuthClient device;

    public PhAuthClients(@Value("${POCKETHIVE_AUTH_BASE_URL:}") String baseUrl,
                         @Value("${POCKETHIVE_ALLOW_REMOTE_HTTP:false}") boolean allowRemoteHttp) {
        Objects.requireNonNull(baseUrl, "PH auth base URL must be explicit or empty");
        if (baseUrl.isBlank()) {
            identity = null;
            device = null;
        } else {
            URI endpoint = URI.create(baseUrl);
            identity = new AuthServiceClient(endpoint, Duration.ofSeconds(5), Duration.ofSeconds(5));
            device = new DeviceAuthClient(endpoint, PocketHiveDeviceAuth.PLANNER_CLIENT_ID,
                Duration.ofSeconds(5), Duration.ofSeconds(5), allowRemoteHttp);
        }
    }

    public boolean configured() {
        return identity != null;
    }

    public AuthServiceClient identity() {
        requireConfigured();
        return identity;
    }

    public DeviceAuthClient device() {
        requireConfigured();
        return device;
    }

    private void requireConfigured() {
        if (!configured()) {
            throw new ApiFailure(503, "PocketHive authentication is not configured.");
        }
    }
}
