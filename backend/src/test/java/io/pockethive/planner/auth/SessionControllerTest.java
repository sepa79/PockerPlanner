package io.pockethive.planner.auth;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.pockethive.auth.contract.PocketHiveDeviceAuth;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.http.ApiErrors;
import io.pockethive.planner.http.SecurityHeaders;
import io.pockethive.planner.http.SessionController;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class SessionControllerTest {
    private SyntheticPh ph;
    private MockMvc http;

    @BeforeEach
    void start() throws Exception {
        ph = new SyntheticPh();
        ph.reply("/api/auth/me", 200, SyntheticPh.identity("local-admin", true));
        ph.reply("/oauth/device_authorization", 200, DeviceSessionServiceTest.authorization());
        ph.reply("/oauth/token", 200, DeviceSessionServiceTest.token());
        ph.reply("/api/auth/device/config", 200, WorkspaceJson.object().put("logoutUri",
            "https://ph.example/auth-service/oauth/device/logout?client_id=pocketplanner-device"));
        ph.reply("/oauth/revoke", 200, "");
        http = controller(ph.clients());
    }

    @AfterEach
    void stop() {
        ph.close();
    }

    @Test
    void anonymousSessionIsSafeAndNeverStoredInBrowserCaches() throws Exception {
        http.perform(get("/api/session")).andExpect(status().isOk())
            .andExpect(jsonPath("$.user").doesNotExist()).andExpect(jsonPath("$.canEdit").value(false))
            .andExpect(jsonPath("$.configured").value(true)).andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void authenticatedSessionOnlyProjectsDisplayFieldsAndCurrentAccess() throws Exception {
        http.perform(get("/api/session").header("Authorization", "Bearer phweb_synthetic"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.user.username").value("local-admin"))
            .andExpect(jsonPath("$.user.displayName").value("Synthetic PH user"))
            .andExpect(jsonPath("$.canEdit").value(true)).andExpect(jsonPath("$.user.id").doesNotExist())
            .andExpect(jsonPath("$.user.grants").doesNotExist()).andExpect(jsonPath("$.access_token").doesNotExist());
        ph.reply("/api/auth/me", 200, SyntheticPh.identity("local-viewer", true));
        http.perform(get("/api/session").header("Authorization", "Bearer phweb_synthetic"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.canEdit").value(false));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void unconfiguredSessionIsViewOnlyButLoginFailsExplicitly(boolean allowRemoteHttp) throws Exception {
        MockMvc unconfigured = controller(new PhAuthClients("", allowRemoteHttp));
        unconfigured.perform(get("/api/session")).andExpect(status().isOk())
            .andExpect(jsonPath("$.canEdit").value(false)).andExpect(jsonPath("$.configured").value(false));
        unconfigured.perform(post("/api/session/device/start").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.error").isString());
    }

    @Test
    void deviceResponsesKeepSharedRfcFieldNamesAndOmitAbsentInterval() throws Exception {
        var authorization = DeviceSessionServiceTest.authorization();
        authorization.remove("interval");
        ph.reply("/oauth/device_authorization", 200, authorization);
        http.perform(post("/api/session/device/start").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.device_code").value("synthetic-device-code"))
            .andExpect(jsonPath("$.user_code").value("AAAA-BBBB"))
            .andExpect(jsonPath("$.verification_uri").value("https://ph.example/auth-service/oauth/device_verification"))
            .andExpect(jsonPath("$.expires_in").value(300)).andExpect(jsonPath("$.interval").doesNotExist())
            .andExpect(jsonPath("$.deviceCode").doesNotExist());
        http.perform(post("/api/session/device/poll").contentType(MediaType.APPLICATION_JSON)
                .content("{\"deviceCode\":\"synthetic-device-code\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.access_token").value("phweb_synthetic-token"))
            .andExpect(jsonPath("$.token_type").value("Bearer")).andExpect(jsonPath("$.expires_in").value(300))
            .andExpect(jsonPath("$.scope").value("pockethive:web"))
            .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void oauthErrorResponseContainsOnlyTheSafeExactErrorCode() throws Exception {
        ph.reply("/oauth/token", 400, WorkspaceJson.object().put("error", "authorization_pending")
            .put("error_description", "Secret upstream diagnostic"));
        http.perform(post("/api/session/device/poll").contentType(MediaType.APPLICATION_JSON)
                .content("{\"deviceCode\":\"synthetic\"}"))
            .andExpect(status().isBadRequest()).andExpect(content().json("{\"error\":\"authorization_pending\"}", true))
            .andExpect(content().string(not(containsString("Secret"))));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "null", "[]", "{}{}", "{\"deviceCode\":42}", "{\"deviceCode\":null}",
        "{\"deviceCode\":\"synthetic\",\"callback\":\"http://elsewhere.invalid\"}",
        "{\"deviceCode\":\"synthetic\",\"deviceCode\":\"second\"}"})
    void pollingUsesTheSoleStrictWorkspaceJsonBoundary(String document) throws Exception {
        http.perform(post("/api/session/device/poll").contentType(MediaType.APPLICATION_JSON).content(document))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").isString());
    }

    @Test
    void parserRejectsInvalidUtf8AndOverOneMiBWithoutCallingPh() throws Exception {
        byte[] invalid = {123, 34, 120, 34, 58, 34, (byte) 0xc3, 34, 125};
        http.perform(post("/api/session/device/poll").contentType(MediaType.APPLICATION_JSON).content(invalid))
            .andExpect(status().isBadRequest());
        http.perform(post("/api/session/device/poll").contentType(MediaType.APPLICATION_JSON)
                .content("{\"deviceCode\":\"" + "x".repeat(1_048_576) + "\"}"))
            .andExpect(status().isBadRequest());
        org.junit.jupiter.api.Assertions.assertEquals(0, ph.calls());
    }

    @ParameterizedTest
    @ValueSource(strings = {"/api/session/device/start", "/api/session/logout"})
    void commandsRejectMissingBodiesAndUnknownFields(String path) throws Exception {
        http.perform(post(path).header("Authorization", "Bearer phweb_synthetic").contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isBadRequest());
        http.perform(post(path).header("Authorization", "Bearer phweb_synthetic").contentType(MediaType.APPLICATION_JSON)
                .content("{\"redirect\":\"https://elsewhere.invalid\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void logoutReturnsTheCanonicalUrlOnlyAfterSuccessfulRevocation() throws Exception {
        http.perform(post("/api/session/logout").header("Authorization", "Bearer phweb_synthetic")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isOk()).andExpect(content().json("{\"logoutUrl\":"
                + "\"https://ph.example/auth-service/oauth/device/logout?client_id=pocketplanner-device\"}", true));
        ph.reply("/oauth/revoke", 500, WorkspaceJson.object().put("error", "Secret revocation details"));
        http.perform(post("/api/session/logout").header("Authorization", "Bearer phweb_synthetic")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.logoutUrl").doesNotExist())
            .andExpect(content().string(not(containsString("Secret"))));
    }

    @Test
    void blankAuthorizationAndWrongRevocationPrefixAreUnauthorized() throws Exception {
        http.perform(get("/api/session").header("Authorization", " ")).andExpect(status().isUnauthorized());
        http.perform(post("/api/session/logout").header("Authorization", "Bearer phmcp_synthetic")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void noPkceConfigExchangeOrCallbackEndpointIsRegistered() throws Exception {
        http.perform(get("/api/session/config")).andExpect(status().isNotFound());
        http.perform(post("/api/session/exchange").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isNotFound());
        http.perform(get("/auth/callback")).andExpect(status().isNotFound());
    }

    @Test
    void remotePublicEndpointsRequireExplicitTransportPermission() throws Exception {
        String issuer = "http://lab.example:8088/auth-service";
        publicEndpoints(issuer);
        http.perform(post("/api/session/device/start").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.verification_uri").doesNotExist());
        http.perform(post("/api/session/logout").header("Authorization", "Bearer phweb_synthetic")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.logoutUrl").doesNotExist());
        org.junit.jupiter.api.Assertions.assertEquals(0, ph.calls("/oauth/revoke"));

        MockMvc allowed = controller(new PhAuthClients(ph.baseUrl(), true));
        allowed.perform(post("/api/session/device/start").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.verification_uri").value(issuer + PocketHiveDeviceAuth.VERIFICATION_PATH));
        allowed.perform(post("/api/session/logout").header("Authorization", "Bearer phweb_synthetic")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.logoutUrl").value(
                issuer + PocketHiveDeviceAuth.LOGOUT_PATH + "?client_id=" + PocketHiveDeviceAuth.PLANNER_CLIENT_ID));
        org.junit.jupiter.api.Assertions.assertEquals(1, ph.calls("/oauth/revoke"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"https://ph.example/auth-service", "http://localhost:8088/auth-service",
        "http://127.0.0.1:8088/auth-service", "http://[::1]:8088/auth-service"})
    void secureAndLoopbackPublicEndpointsNeedNoRemoteHttpPermission(String issuer) throws Exception {
        publicEndpoints(issuer);
        http.perform(post("/api/session/device/start").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.verification_uri").value(issuer + PocketHiveDeviceAuth.VERIFICATION_PATH));
        http.perform(post("/api/session/logout").header("Authorization", "Bearer phweb_synthetic")
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.logoutUrl").value(
                issuer + PocketHiveDeviceAuth.LOGOUT_PATH + "?client_id=" + PocketHiveDeviceAuth.PLANNER_CLIENT_ID));
    }

    private void publicEndpoints(String issuer) {
        ph.reply("/oauth/device_authorization", 200, DeviceSessionServiceTest.authorization()
            .put("verification_uri", issuer + PocketHiveDeviceAuth.VERIFICATION_PATH)
            .put("verification_uri_complete", issuer + PocketHiveDeviceAuth.VERIFICATION_PATH + "?user_code=AAAA-BBBB"));
        ph.reply("/api/auth/device/config", 200, WorkspaceJson.object().put("logoutUri",
            issuer + PocketHiveDeviceAuth.LOGOUT_PATH + "?client_id=" + PocketHiveDeviceAuth.PLANNER_CLIENT_ID));
    }

    private static MockMvc controller(PhAuthClients clients) {
        return MockMvcBuilders.standaloneSetup(new SessionController(new PlannerAccess(clients), new DeviceSessionService(clients)))
            .setControllerAdvice(new ApiErrors()).addFilter(new SecurityHeaders()).build();
    }
}
