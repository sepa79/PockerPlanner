package io.pockethive.planner.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.auth.contract.PocketHiveBrowserAuth;
import io.pockethive.auth.contract.PocketHiveDeviceAuth;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.http.ApiFailure;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

class DeviceSessionServiceTest {
    private static final String LOGOUT_URL = "https://ph.example/auth-service/oauth/device/logout?client_id=pocketplanner-device";
    private SyntheticPh ph;
    private DeviceSessionService devices;

    @BeforeEach
    void start() throws Exception {
        ph = new SyntheticPh();
        ph.reply("/oauth/device_authorization", 200, authorization());
        ph.reply("/oauth/token", 200, token());
        ph.reply("/api/auth/device/config", 200, WorkspaceJson.object().put("logoutUri", LOGOUT_URL));
        ph.reply("/oauth/revoke", 200, "");
        devices = new DeviceSessionService(ph.clients());
    }

    @AfterEach
    void stop() {
        ph.close();
    }

    @Test
    void startUsesOnlyTheRegisteredPlannerDeviceContract() {
        var result = devices.start(WorkspaceJson.object());
        assertEquals("synthetic-device-code", result.deviceCode());
        assertEquals(300, result.expiresIn());
        assertEquals(Map.of("client_id", PocketHiveDeviceAuth.PLANNER_CLIENT_ID,
            "resource", PocketHiveBrowserAuth.RESOURCE, "scope", PocketHiveBrowserAuth.SCOPE),
            ph.form("/oauth/device_authorization"));
        assertEquals("POST", ph.lastRequest("/oauth/device_authorization").get("method"));
        assertTrue(ph.lastRequest("/oauth/device_authorization").get("contentType")
            .startsWith("application/x-www-form-urlencoded"));
        assertEquals("", ph.lastRequest("/oauth/device_authorization").get("authorization"));
    }

    @Test
    void onePollDelegatesExactlyOnceWithoutTrimmingOrInventingAnInterval() {
        ObjectNode authorization = authorization();
        authorization.remove("interval");
        ph.reply("/oauth/device_authorization", 200, authorization);
        assertNull(devices.start(WorkspaceJson.object()).interval());
        var result = devices.poll(WorkspaceJson.object().put("deviceCode", "  synthetic-device-code  "));
        assertEquals("phweb_synthetic-token", result.accessToken());
        assertEquals(Map.of("client_id", PocketHiveDeviceAuth.PLANNER_CLIENT_ID,
            "resource", PocketHiveBrowserAuth.RESOURCE,
            "grant_type", "urn:ietf:params:oauth:grant-type:device_code",
            "device_code", "  synthetic-device-code  "), ph.form("/oauth/token"));
        assertEquals(1, ph.calls("/oauth/token"));
    }

    @Test
    void maximumDeviceCodeLengthIsAcceptedLiterally() {
        String code = "x".repeat(4096);
        devices.poll(WorkspaceJson.object().put("deviceCode", code));
        assertEquals(code, ph.form("/oauth/token").get("device_code"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"deviceCode\":null}", "{\"deviceCode\":1}", "{\"deviceCode\":true}",
        "{\"deviceCode\":[]}", "{\"deviceCode\":{}}", "{\"deviceCode\":\"\"}", "{\"deviceCode\":\"   \"}",
        "{\"deviceCode\":\"synthetic\",\"callback\":\"https://evil.invalid\"}"})
    void pollingRejectsCoercionMissingFieldsAndExtraKeys(String document) {
        assertEquals(400, assertThrows(ApiFailure.class,
            () -> devices.poll(WorkspaceJson.parse(document.getBytes(java.nio.charset.StandardCharsets.UTF_8)))).status());
        assertEquals(0, ph.calls());
    }

    @Test
    void nullAndOverlongCodesAreRejectedBeforeTransport() {
        assertEquals(400, assertThrows(ApiFailure.class, () -> devices.poll(null)).status());
        assertEquals(400, assertThrows(ApiFailure.class,
            () -> devices.poll(WorkspaceJson.object().put("deviceCode", "x".repeat(4097)))).status());
        assertEquals(0, ph.calls());
    }

    @Test
    void startAndLogoutRequireAnExplicitEmptyObject() {
        assertEquals(400, assertThrows(ApiFailure.class, () -> devices.start(null)).status());
        assertEquals(400, assertThrows(ApiFailure.class,
            () -> devices.start(WorkspaceJson.object().put("callback", "https://evil.invalid"))).status());
        assertEquals(400, assertThrows(ApiFailure.class, () -> devices.logout("Bearer phweb_synthetic", null)).status());
        assertEquals(400, assertThrows(ApiFailure.class,
            () -> devices.logout("Bearer phweb_synthetic", WorkspaceJson.object().put("logoutUrl", "https://evil.invalid"))).status());
        assertEquals(0, ph.calls());
    }

    @ParameterizedTest
    @ValueSource(strings = {"authorization_pending", "slow_down", "access_denied", "expired_token", "invalid_grant",
        "invalid_client", "invalid_request", "invalid_scope"})
    void safeOAuthCodesArePreservedWithoutDescriptionsOrRetries(String error) {
        ph.reply("/oauth/token", 400, WorkspaceJson.object().put("error", error)
            .put("error_description", "Secret PH diagnostic and synthetic-device-code"));
        ApiFailure failure = assertThrows(ApiFailure.class,
            () -> devices.poll(WorkspaceJson.object().put("deviceCode", "synthetic-device-code")));
        assertEquals(400, failure.status());
        assertEquals(error, failure.getMessage());
        assertEquals(1, ph.calls("/oauth/token"));
    }

    @Test
    void safeProtocolErrorStillUsesLocalOAuth400WhenPhReturns401() {
        ph.reply("/oauth/token", 401, WorkspaceJson.object().put("error", "invalid_client"));
        ApiFailure failure = assertThrows(ApiFailure.class,
            () -> devices.poll(WorkspaceJson.object().put("deviceCode", "synthetic-device-code")));
        assertEquals(400, failure.status());
        assertEquals("invalid_client", failure.getMessage());
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"error\":\"Secret unknown error\"}", "{\"error\":7}", "not JSON", "null", "[]", "{}"})
    void malformedOAuthErrorsBecomeSafeUnavailability(String body) {
        ph.reply("/oauth/token", 400, body);
        ApiFailure failure = assertThrows(ApiFailure.class,
            () -> devices.poll(WorkspaceJson.object().put("deviceCode", "synthetic-device-code")));
        assertEquals(503, failure.status());
        assertEquals("PocketHive authentication is unavailable.", failure.getMessage());
    }

    @Test
    void logoutRevokesTheActualBrowserTokenBeforeReturningPhOwnedUrl() {
        Map<String, String> result = devices.logout("Bearer phweb_synthetic-token", WorkspaceJson.object());
        assertEquals(Map.of("logoutUrl", LOGOUT_URL), result);
        assertEquals(Map.of("client_id", PocketHiveDeviceAuth.PLANNER_CLIENT_ID,
            "token", "phweb_synthetic-token", "token_type_hint", "access_token"), ph.form("/oauth/revoke"));
        assertEquals("client_id=pocketplanner-device", ph.lastRequest("/api/auth/device/config").get("query"));
        assertEquals("", ph.lastRequest("/oauth/revoke").get("authorization"));
        assertEquals(0, ph.calls("/api/auth/me"));
        assertEquals(1, ph.calls("/oauth/revoke"));
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", " ", "Bearer synthetic", "Bearer phmcp_synthetic", "Bearer phweb_",
        "Bearer phweb_invalid token", "Basic phweb_synthetic"})
    void malformedOrNonBrowserTokensNeverReachRevocation(String authorization) {
        assertEquals(401, assertThrows(ApiFailure.class,
            () -> devices.logout(authorization, WorkspaceJson.object())).status());
        assertEquals(0, ph.calls());
    }

    @Test
    void revocationFailureDoesNotReturnAFalseSuccessOrLogoutLink() {
        ph.reply("/oauth/revoke", 500, WorkspaceJson.object().put("error", "Secret revoke diagnostic"));
        ApiFailure failure = assertThrows(ApiFailure.class,
            () -> devices.logout("Bearer phweb_synthetic", WorkspaceJson.object()));
        assertEquals(503, failure.status());
        assertFalse(failure.getMessage().contains("Secret"));
    }

    @Test
    void wrongClientLogoutConfigurationIsRejectedBeforeRevocation() {
        ph.reply("/api/auth/device/config", 200,
            WorkspaceJson.object().put("logoutUri", LOGOUT_URL.replace("pocketplanner-device", "pocketdata-device")));
        assertEquals(503, assertThrows(ApiFailure.class,
            () -> devices.logout("Bearer phweb_synthetic", WorkspaceJson.object())).status());
        assertEquals(0, ph.calls("/oauth/revoke"));
    }

    @Test
    void upstreamStringsNeverCoerceToTokenOrAuthorizationNumbers() {
        ObjectNode token = token().put("expires_in", "300");
        ph.reply("/oauth/token", 200, token);
        assertEquals(503, assertThrows(ApiFailure.class,
            () -> devices.poll(WorkspaceJson.object().put("deviceCode", "synthetic"))).status());
        ph.reply("/oauth/device_authorization", 200, authorization().put("expires_in", "300"));
        assertEquals(503, assertThrows(ApiFailure.class, () -> devices.start(WorkspaceJson.object())).status());
    }

    @Test
    void redirectsNeverReceiveDeviceCodesOrRevocationTokens() {
        ph.redirect("/oauth/token", 307, ph.baseUrl() + "/stolen-code");
        ph.redirect("/oauth/revoke", 308, ph.baseUrl() + "/stolen-token");
        assertEquals(503, assertThrows(ApiFailure.class,
            () -> devices.poll(WorkspaceJson.object().put("deviceCode", "synthetic-device-code"))).status());
        assertEquals(503, assertThrows(ApiFailure.class,
            () -> devices.logout("Bearer phweb_synthetic", WorkspaceJson.object())).status());
        assertEquals(0, ph.calls("/stolen-code"));
        assertEquals(0, ph.calls("/stolen-token"));
    }

    @Test
    void unconfiguredAuthDeniesDeviceOperationsExplicitly() {
        DeviceSessionService absent = new DeviceSessionService(new PhAuthClients("", false));
        assertEquals(503, assertThrows(ApiFailure.class, () -> absent.start(WorkspaceJson.object())).status());
        assertEquals(503, assertThrows(ApiFailure.class,
            () -> absent.poll(WorkspaceJson.object().put("deviceCode", "synthetic"))).status());
        assertEquals(503, assertThrows(ApiFailure.class,
            () -> absent.logout("Bearer phweb_synthetic", WorkspaceJson.object())).status());
        assertEquals(0, ph.calls());
    }

    static ObjectNode authorization() {
        return WorkspaceJson.object().put("device_code", "synthetic-device-code").put("user_code", "AAAA-BBBB")
            .put("verification_uri", "https://ph.example/auth-service/oauth/device_verification")
            .put("verification_uri_complete", "https://ph.example/auth-service/oauth/device_verification?user_code=AAAA-BBBB")
            .put("expires_in", 300).put("interval", 5);
    }

    static ObjectNode token() {
        return WorkspaceJson.object().put("access_token", "phweb_synthetic-token").put("token_type", "Bearer")
            .put("expires_in", 300).put("scope", "pockethive:web");
    }
}
