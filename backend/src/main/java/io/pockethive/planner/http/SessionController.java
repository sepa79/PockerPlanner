package io.pockethive.planner.http;

import io.pockethive.auth.contract.DeviceAuthorizationDto;
import io.pockethive.auth.contract.DeviceTokenDto;
import io.pockethive.planner.auth.DeviceSessionService;
import io.pockethive.planner.auth.PlannerAccess;
import io.pockethive.planner.auth.SessionAccess;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * Responsibility: map bounded session HTTP requests to Planner access and shared device services.
 * Must not: deserialize through an alternate mapper, manage OAuth state or authorize edits itself.
 * Contract: docs/POCKET_FAMILY_UNIFICATION.md shared authentication and session API slice.
 */
@RestController
public final class SessionController {
    private final PlannerAccess access;
    private final DeviceSessionService devices;

    public SessionController(PlannerAccess access, DeviceSessionService devices) {
        this.access = access;
        this.devices = devices;
    }

    @GetMapping("/api/session")
    public SessionAccess session(@RequestHeader(value = "Authorization", required = false) String authorization) {
        return access.access(authorization);
    }

    @PostMapping("/api/session/device/start")
    public DeviceAuthorizationDto start(HttpServletRequest request) {
        return devices.start(JsonRequests.read(request));
    }

    @PostMapping("/api/session/device/poll")
    public DeviceTokenDto poll(HttpServletRequest request) {
        return devices.poll(JsonRequests.read(request));
    }

    @PostMapping("/api/session/logout")
    public Map<String, String> logout(HttpServletRequest request,
        @RequestHeader(value = "Authorization", required = false) String authorization) {
        return devices.logout(authorization, JsonRequests.read(request));
    }
}
