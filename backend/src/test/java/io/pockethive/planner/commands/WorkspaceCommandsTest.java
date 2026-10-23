package io.pockethive.planner.commands;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.RevisionConflict;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.persistence.WorkspaceStore;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.math.BigInteger;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class WorkspaceCommandsTest {
    @TempDir Path temporary;
    private WorkspaceStore store;
    private WorkspaceCommands commands;

    @BeforeEach
    void initialize() throws Exception {
        WorkspaceValidator validator = new WorkspaceValidator();
        store = new WorkspaceStore(temporary.resolve("commands.sqlite3"),
                Clock.fixed(Instant.parse("2026-01-08T09:00:00Z"), ZoneOffset.UTC), validator);
        commands = new WorkspaceCommands(store, validator);
        try (var input = getClass().getResourceAsStream("/contracts/workspace.json")) {
            store.write(WorkspaceJson.parse(input.readAllBytes()));
        }
    }

    @Test
    void listAndGetAreRevisionedReadOnlyProjections() {
        ObjectNode before = store.read();
        assertEquals(1, commands.listPlans().get("plans").size());
        assertEquals(3, commands.listPlans().at("/plans/0").size());
        assertEquals(before.at("/plans/0"), commands.getPlan("contract-plan").get("plan"));
        assertThrows(InvalidWorkspace.class, () -> commands.getPlan("missing"));
        assertEquals(before, store.read());
    }

    @Test
    void createPlanKeepsOtherPlansAndRejectsImplicitUpsert() {
        ObjectNode before = store.read();
        ObjectNode created = commands.createPlan("new-plan", "Second plan", "Synthetic", BigInteger.ONE, null);
        assertEquals(before.at("/plans/0"), created.at("/plans/0"));
        assertEquals("new-plan", created.at("/plans/1/id").textValue());
        assertFalse(created.at("/plans/1").has("deadline"));
        assertThrows(InvalidWorkspace.class, () -> commands.createPlan("new-plan", "Duplicate", "", BigInteger.TWO, null));
        assertEquals(created, store.read());
    }

    @Test
    void deadlineCanBeSetAndExplicitlyClearedWithoutChangingActivityDates() {
        ObjectNode before = store.read();
        ObjectNode updated = commands.updatePlan("contract-plan", WorkspaceJson.object().put("deadline", "2026-02-28"), BigInteger.ONE);
        assertEquals(before.at("/plans/0/activities"), updated.at("/plans/0/activities"));
        updated = commands.updatePlan("contract-plan", WorkspaceJson.object().putNull("deadline"), BigInteger.TWO);
        assertEquals(WorkspaceJson.object().putNull("deadline").get("deadline"), updated.at("/plans/0/deadline"));
    }

    @Test
    void invalidExpectedRevisionOrEditableFieldsCannotChangeState() {
        ObjectNode before = store.read();
        assertThrows(InvalidWorkspace.class, () -> commands.updatePlan("contract-plan", WorkspaceJson.object(), BigInteger.ONE));
        assertThrows(InvalidWorkspace.class, () -> commands.updatePlan("contract-plan", WorkspaceJson.object().put("id", "other"), BigInteger.ONE));
        assertThrows(InvalidWorkspace.class, () -> commands.updatePlan("contract-plan", WorkspaceJson.object().put("name", "other"), BigInteger.valueOf(-1)));
        assertThrows(RevisionConflict.class, () -> commands.updatePlan("contract-plan", WorkspaceJson.object().put("name", "other"), BigInteger.ZERO));
        assertEquals(before, store.read());
    }

    @Test
    void creationAndUpdateUseTheSameValidationWithoutNormalizingIds() {
        ObjectNode stream = WorkspaceJson.object().put("id", "new-stream").put("name", "New stream").put("description", "");
        ObjectNode created = commands.createItem("contract-plan", PlanCollection.STREAMS, stream, BigInteger.ONE);
        assertEquals(stream, created.at("/plans/0/streams/2"));
        assertThrows(InvalidWorkspace.class, () -> commands.updateItem("contract-plan", PlanCollection.STREAMS,
                "new-stream", WorkspaceJson.object().put("dependsOn", "new-stream"), BigInteger.TWO));
        stream.put("id", " spaced ");
        assertThrows(InvalidWorkspace.class, () -> commands.createItem("contract-plan", PlanCollection.STREAMS, stream, BigInteger.TWO));
        assertEquals(created, store.read());
    }

    @Test
    void activityEditorUsesExplicitCreationAndUnchangedIdentity() {
        ObjectNode item = ((ObjectNode) store.read().at("/plans/0/activities/0")).deepCopy();
        item.put("progress", 50);
        ObjectNode request = WorkspaceJson.object().put("planId", "contract-plan")
                .put("activityId", "activity-alpha-minimal").put("expectedRevision", 1);
        request.set("item", item);
        ObjectNode updated = commands.saveActivity(request);
        assertEquals(50, updated.at("/plans/0/activities/0/progress").intValue());
        assertFalse(updated.at("/plans/0/activities/0").has("startedAt"));
        request.put("expectedRevision", 2).put("activityId", "missing");
        assertThrows(InvalidWorkspace.class, () -> commands.saveActivity(request));
        request.putNull("activityId");
        assertThrows(InvalidWorkspace.class, () -> commands.saveActivity(request));
        assertEquals(updated, store.read());
    }

    @Test
    void malformedActionsAndServerOwnedMetadataAreRejectedAtomically() {
        ObjectNode before = store.read();
        assertThrows(InvalidWorkspace.class, () -> commands.updateItem("contract-plan", PlanCollection.ACTIVITIES,
                "activity-alpha-minimal", WorkspaceJson.object().put("started", "true"), BigInteger.ONE));
        assertThrows(InvalidWorkspace.class, () -> commands.updateItem("contract-plan", PlanCollection.ACTIVITIES,
                "activity-alpha-minimal", WorkspaceJson.object().put("blockerTrackingSince", "2026-01-08T09:00:00Z"), BigInteger.ONE));
        assertEquals(before, store.read());
    }
}
