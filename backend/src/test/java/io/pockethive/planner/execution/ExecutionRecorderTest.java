package io.pockethive.planner.execution;

import static io.pockethive.planner.execution.ExecutionTestDocuments.activity;
import static io.pockethive.planner.execution.ExecutionTestDocuments.issue;
import static io.pockethive.planner.execution.ExecutionTestDocuments.plan;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.ActivityKey;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ExecutionRecorderTest {
    private final WorkspaceValidator validator = new WorkspaceValidator();
    private static final Instant START = Instant.parse("2026-01-12T10:00:00Z");
    private static final Instant FINISH = Instant.parse("2026-01-14T10:00:00Z");
    private static final ActivityKey KEY = new ActivityKey("contract-plan", "activity-alpha-minimal");
    private ObjectNode current;

    @BeforeEach
    void loadSyntheticWorkspace() throws IOException {
        current = ExecutionTestDocuments.workspace();
        validator.validate(current);
    }

    @Test
    void percentagesDoNotInventStartsAndRepeatedStartIsIdempotent() {
        edit(WorkspaceJson.object().put("progress", 50), WorkspaceJson.object(), START);
        assertFalse(activity(current).has("startedAt"));
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        JsonNode recorded = activity(current).deepCopy();
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), FINISH);
        assertEquals(recorded, activity(current));
        assertEquals(START.toString(), activity(current).path("startedAt").textValue());
        assertFalse(activity(current).has("started"));
    }

    @Test
    void startedAndDoneShareOneTransactionTimeWithoutAnInventedEarlierStart() {
        edit(WorkspaceJson.object().put("progress", 100),
                WorkspaceJson.object().put("started", true).put("done", true), START);
        assertEquals(START.toString(), activity(current).path("startedAt").textValue());
        assertEquals(START.toString(), activity(current).path("completedAt").textValue());
        assertFalse(activity(current).has("blockerTrackingSince"));
        assertFalse(activity(current).has("blockerIntervals"));
    }

    @Test
    void doneAloneDoesNotInventStartAndRepeatedDoneKeepsCompletion() {
        edit(WorkspaceJson.object().put("progress", 100), WorkspaceJson.object().put("done", true), START);
        assertFalse(activity(current).has("startedAt"));
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("done", true), FINISH);
        assertEquals(START.toString(), activity(current).path("completedAt").textValue());
    }

    @Test
    void reachingOneHundredRecordsCompletionAndLoweringProgressClearsIt() {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        edit(WorkspaceJson.object().put("progress", 100), WorkspaceJson.object(), FINISH);
        assertEquals(FINISH.toString(), activity(current).path("completedAt").textValue());
        edit(WorkspaceJson.object().put("progress", 60), WorkspaceJson.object(), FINISH.plusSeconds(3600));
        assertFalse(activity(current).has("completedAt"));
        assertEquals(START.toString(), activity(current).path("startedAt").textValue());
        assertEquals(2, intervals().size());
        assertTrue(intervals().get(1).path("endedAt").isNull());
    }

    @Test
    void undoDoneRequiresAnExplicitValidProgressWithoutGuessing() {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        edit(WorkspaceJson.object().put("progress", 100), WorkspaceJson.object().put("done", true), FINISH);
        ObjectNode before = current.deepCopy();
        InvalidWorkspace error = assertThrows(InvalidWorkspace.class,
                () -> edit(WorkspaceJson.object(), WorkspaceJson.object().put("done", false), FINISH));
        assertTrue(error.getMessage().contains("progress below 100"));
        assertEquals(before, current);
        edit(WorkspaceJson.object().put("progress", 40), WorkspaceJson.object().put("done", false), FINISH);
        assertEquals(40, activity(current).path("progress").intValue());
        assertFalse(activity(current).has("completedAt"));
        assertEquals(START.toString(), activity(current).path("startedAt").textValue());
    }

    @Test
    void undoStartedClearsExecutionButKeepsPlanAssignmentsAndEstimate() {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        edit(WorkspaceJson.object().put("progress", 100), WorkspaceJson.object().put("done", true), FINISH);
        ObjectNode before = activity(current).deepCopy();
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", false), FINISH);
        assertEquals(0, activity(current).path("progress").intValue());
        for (String field : List.of("startedAt", "completedAt", "blockerTrackingSince", "blockerIntervals")) {
            assertFalse(activity(current).has(field), field);
        }
        for (String field : List.of("start", "durationDays", "issueIds", "status")) {
            assertEquals(before.get(field), activity(current).get(field), field);
        }
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), FINISH);
        assertEquals(FINISH.toString(), activity(current).path("startedAt").textValue());
        assertEquals(1, intervals().size());
    }

    @Test
    void contradictoryResetActionsAreRejectedWithoutChangingCurrent() {
        for (ObjectNode action : List.of(
                WorkspaceJson.object().put("started", false).put("done", true),
                WorkspaceJson.object().put("started", false).put("startedAt", START.toString()),
                WorkspaceJson.object().put("started", false).putNull("completedAt"))) {
            ObjectNode before = current.deepCopy();
            assertThrows(InvalidWorkspace.class, () -> edit(WorkspaceJson.object(), action, FINISH));
            assertEquals(before, current);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"started", "done"})
    void actionFlagsMustBeRealBooleans(String field) {
        assertThrows(InvalidWorkspace.class,
                () -> edit(WorkspaceJson.object(), WorkspaceJson.object().put(field, "true"), START));
    }

    @Test
    void completionRequiresOneHundredPercent() {
        assertThrows(InvalidWorkspace.class,
                () -> edit(WorkspaceJson.object(), WorkspaceJson.object().put("done", true), START));
        assertThrows(InvalidWorkspace.class,
                () -> edit(WorkspaceJson.object(), WorkspaceJson.object().put("completedAt", START.toString()), START));
    }

    @ParameterizedTest
    @ValueSource(strings = {"startedAt", "completedAt", "blockerTrackingSince", "blockerIntervals"})
    void rawSavesCannotRewriteRecordedFacts(String field) {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        edit(WorkspaceJson.object().put("progress", 100), WorkspaceJson.object().put("done", true), FINISH);
        ObjectNode before = current.deepCopy();
        ObjectNode draft = current.deepCopy();
        if (field.equals("blockerIntervals")) {
            activity(draft).set(field, WorkspaceJson.array());
        } else {
            activity(draft).putNull(field);
        }
        InvalidWorkspace error = assertThrows(InvalidWorkspace.class,
                () -> ExecutionRecorder.record(draft, current, Map.of(), FINISH));
        assertTrue(error.getMessage().contains("server-owned"));
        assertEquals(before, current);
    }

    @Test
    void missingFieldsAreRestoredAndCurrentTreeIsNeverAliased() {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        ObjectNode before = current.deepCopy();
        ObjectNode draft = current.deepCopy();
        activity(draft).remove(List.of("startedAt", "blockerTrackingSince", "blockerIntervals"));
        ExecutionRecorder.record(draft, current, Map.of(), FINISH);
        assertEquals(activity(before), activity(draft));
        ((ObjectNode) activity(draft).path("blockerIntervals").get(0)).put("title", "Draft-only change");
        assertEquals(before, current);
    }

    @Test
    void blockingFollowsCloseReopenAssignmentsAndCompletionWithOneTimestamp() {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        assertEquals(START.toString(), intervals().get(0).path("startedAt").textValue());
        ObjectNode closed = current.deepCopy();
        issue(closed).put("open", false);
        save(closed, Map.of(), START.plusSeconds(3600));
        assertEquals(issue(current).path("resolvedAt"), intervals().get(0).path("endedAt"));
        ObjectNode reopened = current.deepCopy();
        issue(reopened).put("open", true);
        save(reopened, Map.of(), START.plusSeconds(7200));
        assertEquals(2, intervals().size());
        ObjectNode unlinked = current.deepCopy();
        activity(unlinked).set("issueIds", WorkspaceJson.array());
        IssueAssignments.assign(plan(unlinked), activity(unlinked));
        save(unlinked, Map.of(), START.plusSeconds(10800));
        assertEquals(START.plusSeconds(10800).toString(), intervals().get(1).path("endedAt").textValue());
        ObjectNode linked = current.deepCopy();
        activity(linked).withArray("issueIds").add("issue-shared-blocker");
        IssueAssignments.assign(plan(linked), activity(linked));
        save(linked, Map.of(), START.plusSeconds(14400));
        edit(WorkspaceJson.object().put("progress", 100), WorkspaceJson.object().put("done", true), FINISH);
        assertEquals(3, intervals().size());
        assertEquals(activity(current).path("completedAt"), intervals().get(2).path("endedAt"));
    }

    @Test
    void overlappingBlockersKeepSeparateHistoryAfterDeletion() {
        ObjectNode additional = issue(current).deepCopy().put("id", "second-issue");
        plan(current).withArray("issues").add(additional);
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        assertEquals(2, intervals().size());
        ObjectNode removed = current.deepCopy();
        plan(removed).set("issues", WorkspaceJson.array());
        plan(removed).path("activities").forEach(item -> ((ObjectNode) item).set("issueIds", WorkspaceJson.array()));
        save(removed, Map.of(), FINISH);
        assertEquals(2, intervals().size());
        for (JsonNode interval : intervals()) {
            assertEquals(FINISH.toString(), interval.path("endedAt").textValue());
            assertEquals("Synthetic shared blocker", interval.path("title").textValue());
        }
    }

    @Test
    void turningOffBlockerClosesTrackingWithoutChangingAssignment() {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        ObjectNode nonBlocking = current.deepCopy();
        issue(nonBlocking).put("blocker", false);
        save(nonBlocking, Map.of(), FINISH);
        assertEquals(FINISH.toString(), intervals().get(0).path("endedAt").textValue());
        assertTrue(IssueAssignments.affects(issue(current), activity(current)));
    }

    @Test
    void backdatingStartPreservesLexicalTimestampAndDoesNotInventBlocking() {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        JsonNode observed = intervals().deepCopy();
        String correction = "2026-01-10T11:30:00.123456+01:30";
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("startedAt", correction), FINISH);
        assertEquals(correction, activity(current).path("startedAt").textValue());
        assertEquals(START.toString(), activity(current).path("blockerTrackingSince").textValue());
        assertEquals(observed, intervals());
    }

    @Test
    void movingStartForwardClipsTrackingAndIntervals() {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        String correction = "2026-01-12T12:00:00Z";
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("startedAt", correction), FINISH);
        assertEquals(correction, activity(current).path("blockerTrackingSince").textValue());
        assertEquals(correction, intervals().get(0).path("startedAt").textValue());
    }

    @Test
    void movingCompletionEarlierClipsObservedBlockingAndLaterDoesNotStretchIt() {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        edit(WorkspaceJson.object().put("progress", 100), WorkspaceJson.object().put("done", true), FINISH);
        String correction = "2026-01-13T12:00:00Z";
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("completedAt", correction), FINISH);
        assertEquals(correction, intervals().get(0).path("endedAt").textValue());
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("completedAt", FINISH.toString()), FINISH);
        assertEquals(correction, intervals().get(0).path("endedAt").textValue());
    }

    @Test
    void completedPeriodBeforeTrackingHasNoRecordedBlocking() {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        edit(WorkspaceJson.object().put("progress", 100), WorkspaceJson.object().put("done", true), FINISH);
        edit(WorkspaceJson.object(), WorkspaceJson.object()
                .put("startedAt", "2026-01-10T09:00:00Z").put("completedAt", "2026-01-11T09:00:00Z"), FINISH);
        assertFalse(activity(current).has("blockerTrackingSince"));
        assertFalse(activity(current).has("blockerIntervals"));
    }

    @Test
    void correctedPeriodDropsIntervalsEntirelyOutsideIt() {
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        ObjectNode closed = current.deepCopy();
        issue(closed).put("open", false);
        save(closed, Map.of(), START.plusSeconds(3600));
        ObjectNode reopened = current.deepCopy();
        issue(reopened).put("open", true);
        save(reopened, Map.of(), START.plusSeconds(7200));
        edit(WorkspaceJson.object().put("progress", 100), WorkspaceJson.object().put("done", true), FINISH);
        edit(WorkspaceJson.object(), WorkspaceJson.object()
                .put("startedAt", START.plusSeconds(3600).toString())
                .put("completedAt", START.plusSeconds(7200).toString()), FINISH);
        assertEquals(0, intervals().size());
        assertEquals(START.plusSeconds(3600).toString(), activity(current).path("blockerTrackingSince").textValue());
    }

    @ParameterizedTest
    @ValueSource(strings = {"2026-01-12", "2026-01-12T10:00:00", "2026-01-15T10:00:00Z", "2026-02-30T10:00:00Z"})
    void dateCorrectionsRejectInvalidAndFutureDates(String correction) {
        ObjectNode before = current.deepCopy();
        assertThrows(InvalidWorkspace.class,
                () -> edit(WorkspaceJson.object(), WorkspaceJson.object().put("startedAt", correction), FINISH));
        assertEquals(before, current);
    }

    @Test
    void nullCorrectionsAndReversedInstantsAreRejected() {
        assertThrows(InvalidWorkspace.class,
                () -> edit(WorkspaceJson.object(), WorkspaceJson.object().putNull("startedAt"), FINISH));
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        ObjectNode before = current.deepCopy();
        assertThrows(InvalidWorkspace.class, () -> edit(WorkspaceJson.object().put("progress", 100),
                WorkspaceJson.object().put("completedAt", "2026-01-12T10:30:00+01:00"), FINISH));
        assertEquals(before, current);
    }

    @Test
    void historicalNewRecordsPreserveFactsAndOptionalNullShapes() {
        ObjectNode draft = current.deepCopy();
        ObjectNode historical = activity(draft).deepCopy().put("id", "historical").put("progress", 100)
                .put("startedAt", "2026-01-01T09:00:00+00:00").put("completedAt", "2026-01-03T10:00:00Z");
        ObjectNode undated = historical.deepCopy().put("id", "undated").putNull("startedAt").putNull("completedAt");
        plan(draft).withArray("activities").add(historical).add(undated);
        save(draft, Map.of(), START);
        assertEquals(historical, plan(current).path("activities").get(3));
        assertEquals(undated, plan(current).path("activities").get(4));
    }

    @Test
    void identicalActivityIdsInOtherPlansDoNotShareExecutionFactsOrActions() {
        ObjectNode other = plan(current).deepCopy().put("id", "other-plan");
        current.withArray("plans").add(other);
        edit(WorkspaceJson.object(), WorkspaceJson.object().put("started", true), START);
        assertFalse(current.path("plans").get(1).path("activities").get(0).has("startedAt"));
    }

    @Test
    void intervalLimitRemainsAtCanonicalValidationOwner() {
        ObjectNode item = activity(current);
        item.put("startedAt", START.toString());
        item.put("blockerTrackingSince", START.toString());
        ArrayNode history = WorkspaceJson.array();
        for (int index = 0; index < 1000; index++) {
            history.add(WorkspaceJson.object().put("issueId", "historical-" + index)
                    .put("title", "Historical synthetic blocker").put("startedAt", START.toString())
                    .put("endedAt", START.toString()));
        }
        item.set("blockerIntervals", history);
        validator.validate(current);
        ObjectNode before = current.deepCopy();
        assertThrows(InvalidWorkspace.class, () -> save(current.deepCopy(), Map.of(), FINISH));
        assertEquals(before, current);
    }

    private ArrayNode intervals() {
        return (ArrayNode) activity(current).get("blockerIntervals");
    }

    private void edit(ObjectNode changes, ObjectNode action, Instant now) {
        ObjectNode draft = current.deepCopy();
        activity(draft).setAll(changes);
        if (activity(draft).path("progress").intValue() < 100) {
            activity(draft).remove("completedAt");
        }
        save(draft, Map.of(KEY, action), now);
    }

    private void save(ObjectNode draft, Map<ActivityKey, ObjectNode> actions, Instant now) {
        ObjectNode before = current.deepCopy();
        validator.validate(draft);
        IssueResolutions.record(draft, current, now);
        ExecutionRecorder.record(draft, current, actions, now);
        validator.validate(draft);
        assertEquals(before, current);
        current = draft;
    }
}
