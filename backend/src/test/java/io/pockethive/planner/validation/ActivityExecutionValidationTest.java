package io.pockethive.planner.validation;

import static io.pockethive.planner.validation.ValidationFixtures.activity;
import static io.pockethive.planner.validation.ValidationFixtures.workspace;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

class ActivityExecutionValidationTest {
    private final WorkspaceValidator validator = new WorkspaceValidator();

    @ParameterizedTest
    @MethodSource("invalidExecution")
    void rejectsInvalidPersistedTimingWithoutChangingTheTree(String json) {
        ObjectNode document = workspace();
        ValidationFixtures.value(json).properties().forEach(entry -> activity(document).set(entry.getKey(), entry.getValue()));
        ObjectNode before = document.deepCopy();
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
        assertEquals(before, document);
    }

    static Stream<Arguments> invalidExecution() {
        return Stream.of(
                Arguments.of("{\"startedAt\":true}"),
                Arguments.of("{\"completedAt\":\"2026-01-05T10:00:00Z\"}"),
                Arguments.of("{\"progress\":100,\"startedAt\":\"2026-01-06T10:00:00Z\",\"completedAt\":\"2026-01-05T10:00:00Z\"}"),
                Arguments.of("{\"blockerTrackingSince\":\"2026-01-05T10:00:00Z\"}"),
                Arguments.of("{\"startedAt\":\"2026-01-05T11:00:00Z\",\"blockerTrackingSince\":\"2026-01-05T10:00:00Z\"}"),
                Arguments.of("{\"progress\":100,\"startedAt\":\"2026-01-05T10:00:00Z\",\"completedAt\":\"2026-01-05T11:00:00Z\",\"blockerTrackingSince\":\"2026-01-05T12:00:00Z\"}"),
                Arguments.of("{\"blockerIntervals\":null}"),
                Arguments.of("{\"blockerIntervals\":{}}"),
                Arguments.of("{\"blockerIntervals\":[null]}"),
                Arguments.of("{\"blockerIntervals\":[{}]}")
        );
    }

    @Test
    void permitsUnknownStartAndOptionalNullFactsWithoutGuessingThem() {
        ObjectNode document = workspace();
        activity(document).put("progress", 100);
        activity(document).putNull("startedAt");
        activity(document).put("completedAt", "2026-01-06T10:00:00Z");
        activity(document).putNull("blockerTrackingSince");
        activity(document).set("blockerIntervals", WorkspaceJson.array());
        assertDoesNotThrow(() -> validator.validate(document));
    }

    @Test
    void comparesChronologyUsingInstantsRatherThanOffsetLabels() {
        ObjectNode document = workspace();
        activity(document).put("progress", 100);
        activity(document).put("startedAt", "2026-10-25T01:30:00+01:00");
        activity(document).put("completedAt", "2026-10-25T01:15:00Z");
        assertDoesNotThrow(() -> validator.validate(document));
        activity(document).put("completedAt", "2026-10-25T01:15:00+01:00");
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @Test
    void validatesStructureWithoutAClockOrInventingFutureTimePolicy() {
        ObjectNode document = workspace();
        activity(document).put("startedAt", "2099-01-05T10:00:00Z");
        assertDoesNotThrow(() -> validator.validate(document));
    }

    @Test
    void acceptsHistoricalDeletedIssuesAndConcurrentDifferentBlockers() {
        ObjectNode document = trackedWorkspace();
        ArrayNode intervals = activity(document).withArray("blockerIntervals");
        intervals.add(interval("deleted-issue", "2026-01-05T10:00:00Z", "2026-01-05T11:00:00Z"));
        intervals.add(interval("other-deleted-issue", "2026-01-05T10:00:00Z", null));
        intervals.add(interval("deleted-issue", "2026-01-05T11:00:00Z", null));
        ObjectNode before = document.deepCopy();
        assertDoesNotThrow(() -> validator.validate(document));
        assertEquals(before, document);
    }

    @Test
    void rejectsOverlappingOrOutOfOrderSpansForTheSameIssue() {
        ObjectNode document = trackedWorkspace();
        ArrayNode intervals = activity(document).withArray("blockerIntervals");
        intervals.add(interval("old-issue", "2026-01-05T10:00:00Z", "2026-01-05T12:00:00Z"));
        intervals.add(interval("old-issue", "2026-01-05T11:00:00Z", "2026-01-05T13:00:00Z"));
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
        ((ObjectNode) intervals.get(0)).putNull("endedAt");
        ((ObjectNode) intervals.get(1)).put("startedAt", "2026-01-05T12:00:00Z");
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @ParameterizedTest
    @ValueSource(strings = {"issueId", "title", "startedAt", "endedAt"})
    void rejectsIncompleteIntervalFields(String field) {
        ObjectNode document = trackedWorkspace();
        ObjectNode interval = interval("old-issue", "2026-01-05T10:00:00Z", null);
        interval.remove(field);
        activity(document).withArray("blockerIntervals").add(interval);
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @Test
    void rejectsAdditionalIntervalFields() {
        ObjectNode document = trackedWorkspace();
        activity(document).withArray("blockerIntervals").add(
                interval("old-issue", "2026-01-05T10:00:00Z", null).put("extra", true));
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @ParameterizedTest
    @ValueSource(strings = {"before-tracking", "reversed", "after-completion", "open-after-completion", "untracked", "padded-id"})
    void enforcesRecordedIntervalChronologyAndLiteralIds(String invalidCase) {
        ObjectNode document = trackedWorkspace();
        ObjectNode interval = interval("old-issue", "2026-01-05T10:00:00Z", "2026-01-05T11:00:00Z");
        switch (invalidCase) {
            case "before-tracking" -> interval.put("startedAt", "2026-01-05T09:00:00Z");
            case "reversed" -> interval.put("endedAt", "2026-01-05T09:00:00Z");
            case "after-completion", "open-after-completion" -> {
                activity(document).put("progress", 100);
                activity(document).put("completedAt", "2026-01-05T10:30:00Z");
                if (invalidCase.equals("open-after-completion")) {
                    interval.putNull("endedAt");
                }
            }
            case "untracked" -> activity(document).remove("blockerTrackingSince");
            case "padded-id" -> interval.put("issueId", "old-issue ");
            default -> throw new IllegalArgumentException(invalidCase);
        }
        activity(document).withArray("blockerIntervals").add(interval);
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @Test
    void permitsExactlyOneThousandSpansAndRejectsTheNext() {
        ObjectNode document = trackedWorkspace();
        ArrayNode intervals = activity(document).withArray("blockerIntervals");
        for (int index = 0; index < 1000; index++) {
            intervals.add(interval("old-issue", "2026-01-05T10:00:00Z", "2026-01-05T10:00:00Z"));
        }
        assertDoesNotThrow(() -> validator.validate(document));
        intervals.add(interval("old-issue", "2026-01-05T10:00:00Z", "2026-01-05T10:00:00Z"));
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    private static ObjectNode trackedWorkspace() {
        ObjectNode document = workspace();
        activity(document).put("startedAt", "2026-01-05T09:00:00Z");
        activity(document).put("blockerTrackingSince", "2026-01-05T10:00:00Z");
        activity(document).set("blockerIntervals", WorkspaceJson.array());
        return document;
    }

    private static ObjectNode interval(String issueId, String startedAt, String endedAt) {
        ObjectNode interval = WorkspaceJson.object().put("issueId", issueId).put("title", "Historical blocker").put("startedAt", startedAt);
        if (endedAt == null) {
            interval.putNull("endedAt");
        } else {
            interval.put("endedAt", endedAt);
        }
        return interval;
    }
}
