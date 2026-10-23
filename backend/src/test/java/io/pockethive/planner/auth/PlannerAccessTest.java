package io.pockethive.planner.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.http.ApiFailure;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

class PlannerAccessTest {
    private SyntheticPh ph;
    private PlannerAccess access;

    @BeforeEach
    void start() throws Exception {
        ph = new SyntheticPh();
        ph.reply("/api/auth/me", 200, SyntheticPh.identity("local-admin", true));
        access = new PlannerAccess(ph.clients());
    }

    @AfterEach
    void stop() {
        ph.close();
    }

    @Test
    void anonymousReadIsExplicitlyViewOnlyWithoutCallingPh() {
        SessionAccess session = access.access(null);
        assertNull(session.user());
        assertFalse(session.canEdit());
        assertTrue(session.configured());
        assertEquals(401, assertThrows(ApiFailure.class, () -> access.requireEditor(null)).status());
        assertEquals(0, ph.calls());
    }

    @Test
    void unconfiguredIdentityStillAllowsAnonymousReadOnlyAccess() {
        PlannerAccess absent = new PlannerAccess(new PhAuthClients("", false));
        assertEquals(new SessionAccess(null, false, false), absent.access(null));
        assertEquals(401, assertThrows(ApiFailure.class, () -> absent.requireEditor(null)).status());
        assertEquals(503, assertThrows(ApiFailure.class, () -> absent.access("Bearer synthetic")).status());
        assertEquals(0, ph.calls());
    }

    @Test
    void editorIdentityIsFreshForEveryAuthorizedMutation() {
        access.requireEditor("Bearer phweb_synthetic");
        ph.reply("/api/auth/me", 200, SyntheticPh.identity("local-viewer", true));
        assertEquals(403, assertThrows(ApiFailure.class, () -> access.requireEditor("Bearer phweb_synthetic")).status());
        ph.reply("/api/auth/me", 200, SyntheticPh.identity("local-admin", false));
        assertEquals(401, assertThrows(ApiFailure.class, () -> access.requireEditor("Bearer phweb_synthetic")).status());
        assertEquals(3, ph.calls("/api/auth/me"));
        assertEquals("Bearer phweb_synthetic", ph.lastRequest("/api/auth/me").get("authorization"));
    }

    @Test
    void safeSessionProjectionExposesNoGrantsOrCredentialFields() {
        assertEquals(new SessionAccess(new SessionUser("local-admin", "Synthetic PH user"), true, true),
            access.access("Bearer phweb_synthetic"));
        assertEquals(2, SessionUser.class.getRecordComponents().length);
        assertEquals(3, SessionAccess.class.getRecordComponents().length);
    }

    @ParameterizedTest
    @ValueSource(strings = {"local-viewer", "Local-admin", "local-admin-other", "admin", "LOCAL-ADMIN"})
    void onlyTheExactActiveEditorNameCanEdit(String username) {
        ph.reply("/api/auth/me", 200, SyntheticPh.identity(username, true));
        assertFalse(access.access("Bearer synthetic").canEdit());
        assertEquals(403, assertThrows(ApiFailure.class, () -> access.requireEditor("Bearer synthetic")).status());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " ", "Basic synthetic", "Bearer", "Bearer ", "Bearer  synthetic",
        "Bearer synthetic token", "Bearer synthetic\nInjected", "bearer synthetic", "Bearer synthetic+"})
    void presentButMalformedHeaderNeverBecomesAnonymous(String authorization) {
        assertEquals(401, assertThrows(ApiFailure.class, () -> access.access(authorization)).status());
        assertEquals(0, ph.calls());
    }

    @Test
    void overlongBearerIsRejectedBeforeTransport() {
        assertEquals(401, assertThrows(ApiFailure.class,
            () -> access.access("Bearer " + "x".repeat(16_001))).status());
        assertEquals(0, ph.calls());
    }

    @ParameterizedTest
    @ValueSource(ints = {401, 403})
    void rejectedIdentityIsUnauthorizedWithoutUpstreamDiagnostics(int status) {
        ph.reply("/api/auth/me", status, "{\"error\":\"secret upstream diagnostics\"}");
        ApiFailure failure = assertThrows(ApiFailure.class, () -> access.access("Bearer synthetic"));
        assertEquals(401, failure.status());
        assertFalse(failure.getMessage().contains("secret"));
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 404, 429, 500, 503})
    void unavailableOrUnexpectedIdentityStatusFailsClosed(int status) {
        ph.reply("/api/auth/me", status, "{\"error\":\"secret upstream diagnostics\"}");
        ApiFailure failure = assertThrows(ApiFailure.class, () -> access.access("Bearer synthetic"));
        assertEquals(503, failure.status());
        assertFalse(failure.getMessage().contains("secret"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "", "{}", "[]", "not JSON", "{\"active\":true}"})
    void malformedOrEmptyUpstreamIdentityIsUnavailable(String body) {
        ph.reply("/api/auth/me", 200, body);
        assertEquals(503, assertThrows(ApiFailure.class, () -> access.access("Bearer synthetic")).status());
    }

    @Test
    void upstreamBooleanIsNotCoercedFromAStringOrObject() {
        var identity = SyntheticPh.identity("local-admin", true);
        identity.put("active", "true");
        ph.reply("/api/auth/me", 200, identity);
        assertEquals(503, assertThrows(ApiFailure.class, () -> access.access("Bearer synthetic")).status());
        identity.set("active", WorkspaceJson.object());
        ph.reply("/api/auth/me", 200, identity);
        assertEquals(503, assertThrows(ApiFailure.class, () -> access.access("Bearer synthetic")).status());
    }

    @ParameterizedTest
    @ValueSource(ints = {301, 302, 303, 307, 308})
    void redirectsNeverReceiveTheBearerToken(int status) {
        ph.redirect("/api/auth/me", status, ph.baseUrl() + "/identity-target");
        ph.reply("/identity-target", 200, SyntheticPh.identity("local-admin", true));
        assertEquals(503, assertThrows(ApiFailure.class, () -> access.access("Bearer synthetic")).status());
        assertEquals(0, ph.calls("/identity-target"));
    }

    @Test
    void unavailablePhDoesNotGrantCachedAccess() {
        access.requireEditor("Bearer synthetic");
        ph.close();
        assertEquals(503, assertThrows(ApiFailure.class, () -> access.requireEditor("Bearer synthetic")).status());
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"not a URL", "ftp://127.0.0.1/auth-service", "http://user:password@localhost/auth-service",
        "http://localhost/auth-service?next=elsewhere", "http://localhost/auth-service#fragment"})
    void invalidConfigurationNeverSilentlyDisablesAuth(String endpoint) {
        assertThrows(RuntimeException.class, () -> new PhAuthClients(endpoint, false));
    }
}
