package io.pockethive.planner.http;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.auth.PlannerAccess;
import io.pockethive.planner.commands.WorkspaceCommands;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.persistence.WorkspaceStore;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * Responsibility: map workspace and activity-editor HTTP requests to existing owners.
 * Must not: validate domain fields, infer execution progress or write outside the sole store.
 * Contract: docs/ARCHITECTURE.md /api/state, /api/state/import and /api/activities.
 */
@RestController
public final class WorkspaceController {
    private final WorkspaceStore store;
    private final WorkspaceCommands commands;
    private final PlannerAccess access;

    public WorkspaceController(WorkspaceStore store, WorkspaceCommands commands, PlannerAccess access) {
        this.store = store;
        this.commands = commands;
        this.access = access;
    }

    @GetMapping("/api/state")
    public ResponseEntity<byte[]> read() {
        return json(store.read());
    }

    @PutMapping("/api/state")
    public ResponseEntity<byte[]> save(@RequestHeader(value = "Authorization", required = false) String authorization,
                                        HttpServletRequest request) {
        access.requireEditor(authorization);
        return json(store.write(JsonRequests.read(request)));
    }

    @PutMapping("/api/activities")
    public ResponseEntity<byte[]> activity(@RequestHeader(value = "Authorization", required = false) String authorization,
                                            HttpServletRequest request) {
        access.requireEditor(authorization);
        return json(commands.saveActivity(JsonRequests.read(request)));
    }

    @PutMapping("/api/state/import")
    public ResponseEntity<byte[]> importWorkspace(@RequestHeader(value = "Authorization", required = false) String authorization,
                                                   HttpServletRequest request) {
        access.requireEditor(authorization);
        return json(store.replaceExplicitly(JsonRequests.read(request)));
    }

    private static ResponseEntity<byte[]> json(ObjectNode document) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(WorkspaceJson.encode(document));
    }
}
