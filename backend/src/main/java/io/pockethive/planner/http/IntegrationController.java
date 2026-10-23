package io.pockethive.planner.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.auth.PlannerAccess;
import io.pockethive.planner.integration.LinkedRuns;
import io.pockethive.planner.integration.PlannerCatalogue;
import io.pockethive.planner.integration.RunControls;
import io.pockethive.planner.integration.RuntimeObservations;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Responsibility: map protected PH catalogue, exact run, observation and control HTTP requests.
 * Must not: choose PH permissions, retry execution or save planning/execution facts.
 * Contract: docs/POCKETHIVE_INTEGRATION.md first local integration and exact-run control.
 */
@RestController
public final class IntegrationController {
    private final PlannerAccess access;
    private final PlannerCatalogue catalogue;
    private final LinkedRuns linked;
    private final RuntimeObservations observations;
    private final RunControls controls;

    public IntegrationController(PlannerAccess access, PlannerCatalogue catalogue, LinkedRuns linked,
                                 RuntimeObservations observations, RunControls controls) {
        this.access = access;
        this.catalogue = catalogue;
        this.linked = linked;
        this.observations = observations;
        this.controls = controls;
    }

    @GetMapping("/api/integration/catalogue")
    public ObjectNode catalogue(@RequestHeader(value = "Authorization", required = false) String authorization) {
        access.requireSession(authorization);
        return catalogue.catalogue();
    }

    @GetMapping("/api/integration/runs")
    public ObjectNode runs(@RequestParam(value = "planId", required = false) String planId,
                           @RequestHeader(value = "Authorization", required = false) String authorization) {
        access.requireSession(authorization);
        return linked.read(planId, authorization);
    }

    @GetMapping("/api/integration/execution")
    public ObjectNode execution(@RequestParam(value = "planId", required = false) String planId,
                                @RequestHeader(value = "Authorization", required = false) String authorization) {
        access.requireSession(authorization);
        return observations.read(planId, authorization);
    }

    @PostMapping("/api/integration/control")
    public ResponseEntity<JsonNode> control(HttpServletRequest request,
                          @RequestHeader(value = "Authorization", required = false) String authorization) {
        access.requireSession(authorization);
        return ResponseEntity.accepted().body(controls.control(JsonRequests.read(request), authorization));
    }

    @GetMapping("/api/integration/operation")
    public JsonNode operation(@RequestParam(value = "planId", required = false) String planId,
                              @RequestParam(value = "swarmId", required = false) String swarmId,
                              @RequestParam(value = "runId", required = false) String runId,
                              @RequestParam(value = "correlationId", required = false) String correlationId,
                              @RequestHeader(value = "Authorization", required = false) String authorization) {
        access.requireSession(authorization);
        return controls.operation(planId, swarmId, runId, correlationId, authorization);
    }
}
