package io.pockethive.planner.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.commands.PlanCollection;
import io.pockethive.planner.commands.WorkspaceCommands;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.RevisionConflict;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.domain.WorkspaceLimits;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.math.BigInteger;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class WorkspaceStoreTest {
    @TempDir Path temporary;
    private final WorkspaceValidator validator = new WorkspaceValidator();
    private final Clock clock = Clock.fixed(Instant.parse("2026-01-08T09:00:00Z"), ZoneOffset.UTC);
    private WorkspaceStore store;
    private ObjectNode saved;

    @BeforeEach
    void initialize() throws Exception {
        store = new WorkspaceStore(temporary.resolve("test.sqlite3"), clock, validator);
        try (var input = getClass().getResourceAsStream("/contracts/workspace.json")) {
            saved = store.write(WorkspaceJson.parse(input.readAllBytes()));
        }
    }

    @Test
    void independentStoreReopensSavedStateAndReturnedTreesCannotMutatePersistence() {
        WorkspaceStore reopened = new WorkspaceStore(temporary.resolve("test.sqlite3"), clock, validator);
        assertEquals(saved, reopened.read());
        reopened.read().withArray("plans").removeAll();
        saved.withArray("plans").removeAll();
        assertNotEquals(saved, reopened.read());
    }

    @Test
    void concurrentIndependentWritersCommitExactlyOnce() throws Exception {
        WorkspaceStore second = new WorkspaceStore(temporary.resolve("test.sqlite3"), clock, validator);
        ObjectNode firstDraft = saved.deepCopy();
        ((ObjectNode) firstDraft.at("/plans/0")).put("name", "First writer");
        ObjectNode secondDraft = saved.deepCopy();
        ((ObjectNode) secondDraft.at("/plans/0")).put("name", "Second writer");
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var firstResult = executor.submit(attempt(store, firstDraft, ready, start));
            var secondResult = executor.submit(attempt(second, secondDraft, ready, start));
            if (!ready.await(5, TimeUnit.SECONDS)) {
                throw new AssertionError("Writers failed to reach concurrency barrier");
            }
            start.countDown();
            assertNotEquals(firstResult.get(15, TimeUnit.SECONDS), secondResult.get(15, TimeUnit.SECONDS));
        }
        assertEquals(BigInteger.TWO, store.readRevision());
        assertEquals(store.read(), second.read());
    }

    @Test
    void invalidScopeEditRollsBackAssignmentsProgressAndRevisionTogether() {
        WorkspaceCommands commands = new WorkspaceCommands(store, validator);
        ObjectNode changes = WorkspaceJson.object().put("streamId", "missing").put("started", true);
        changes.set("issueIds", WorkspaceJson.array());
        assertThrows(InvalidWorkspace.class, () -> commands.updateItem("contract-plan", PlanCollection.ACTIVITIES,
                "activity-alpha-minimal", changes, BigInteger.ONE));
        assertEquals(saved, store.read());
    }

    @Test
    void finalByteBoundaryIncludesServerOwnedTimestampsAndRevisionGrowth() {
        WorkspaceCommands commands = new WorkspaceCommands(store, validator);
        ObjectNode initial = store.read();
        ObjectNode activity = (ObjectNode) initial.at("/plans/0/activities/0");
        activity.put("syntheticPadding", "");
        int remaining = WorkspaceLimits.MAX_DOCUMENT_BYTES - WorkspaceJson.encode(initial).length;
        activity.put("syntheticPadding", "x".repeat(remaining));
        ObjectNode full = store.write(initial);
        assertThrows(InvalidWorkspace.class, () -> commands.updateItem("contract-plan", PlanCollection.ACTIVITIES,
                "activity-alpha-minimal", WorkspaceJson.object().put("started", true), BigInteger.TWO));
        assertEquals(full, store.read());
    }

    @Test
    void explicitReplacementRetainsHistoricalFactsWithoutInventingBlockingHistory() {
        ObjectNode replacement = saved.deepCopy();
        ObjectNode activity = (ObjectNode) replacement.at("/plans/0/activities/0");
        activity.put("startedAt", "2026-01-06T09:00:00Z");
        activity.put("completedAt", "2026-01-07T09:00:00Z");
        activity.put("progress", 100);
        ObjectNode imported = store.replaceExplicitly(replacement);
        assertEquals(activity, imported.at("/plans/0/activities/0"));
        assertEquals(BigInteger.TWO, store.readRevision());
    }

    @Test
    void explicitReplacementRejectsAStaleRevisionWithoutReplacingFacts() {
        ObjectNode stale = saved.deepCopy();
        ((ObjectNode) stale.at("/plans/0/activities/0")).put("startedAt", "2026-01-06T09:00:00Z");
        ObjectNode committed = store.write(saved);
        assertThrows(RevisionConflict.class, () -> store.replaceExplicitly(stale));
        assertEquals(committed, store.read());
    }

    @Test
    void explicitReplacementStillValidatesChronologyAndFinalRevisionByteGrowth() {
        ObjectNode invalid = saved.deepCopy();
        ObjectNode activity = (ObjectNode) invalid.at("/plans/0/activities/0");
        activity.put("progress", 100).put("startedAt", "2026-01-07T09:00:00Z").put("completedAt", "2026-01-06T09:00:00Z");
        assertThrows(InvalidWorkspace.class, () -> store.replaceExplicitly(invalid));
        assertEquals(saved, store.read());
        ObjectNode current = saved;
        while (store.readRevision().compareTo(BigInteger.valueOf(9)) < 0) {
            current = store.write(current);
        }
        ObjectNode full = current.deepCopy();
        ObjectNode padded = (ObjectNode) full.at("/plans/0/activities/0");
        padded.put("syntheticPadding", "");
        padded.put("syntheticPadding", "x".repeat(WorkspaceLimits.MAX_DOCUMENT_BYTES - WorkspaceJson.encode(full).length));
        assertEquals(WorkspaceLimits.MAX_DOCUMENT_BYTES, WorkspaceJson.encode(full).length);
        assertThrows(InvalidWorkspace.class, () -> store.replaceExplicitly(full));
        assertEquals(current, store.read());
    }

    @Test
    void aFinalDocumentThatCannotBeReadBackIsRejectedBeforeCommit() throws Exception {
        ObjectNode boundary = saved.deepCopy();
        boundary.put("revision", new BigInteger("9".repeat(1000)));
        try (var connection = java.sql.DriverManager.getConnection("jdbc:sqlite:" + temporary.resolve("test.sqlite3"));
             var statement = connection.prepareStatement("UPDATE planner SET document = ? WHERE id = 1")) {
            statement.setString(1, new String(WorkspaceJson.encode(boundary), java.nio.charset.StandardCharsets.UTF_8));
            statement.executeUpdate();
        }
        assertThrows(InvalidWorkspace.class, () -> store.write(boundary));
        assertEquals(boundary, store.read());
    }

    private Callable<Boolean> attempt(WorkspaceStore target, ObjectNode draft, CountDownLatch ready,
                                       CountDownLatch start) {
        return () -> {
            ready.countDown();
            if (!start.await(5, TimeUnit.SECONDS)) {
                throw new AssertionError("Concurrent write barrier timed out");
            }
            try {
                target.write(draft);
                return true;
            } catch (RevisionConflict exception) {
                return false;
            }
        };
    }
}
