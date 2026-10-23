package io.pockethive.planner.validation;

import static io.pockethive.planner.validation.ValidationFixtures.activity;
import static io.pockethive.planner.validation.ValidationFixtures.issue;
import static io.pockethive.planner.validation.ValidationFixtures.plan;
import static io.pockethive.planner.validation.ValidationFixtures.workspace;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
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

class WorkspaceReferencesTest {
    private final WorkspaceValidator validator = new WorkspaceValidator();

    @ParameterizedTest
    @ValueSource(strings = {"/plans", "/plans/0/streams", "/plans/0/activityTypes", "/plans/0/activities", "/plans/0/issues"})
    void rejectsDuplicateIdsWithinEveryCollection(String pointer) {
        ObjectNode document = workspace();
        ArrayNode items = (ArrayNode) document.at(pointer);
        items.add(items.get(0).deepCopy());
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " ", " id", "id ", "\tid", "id\n", "\u00a0id", "id\u0085", "\u2007id", "id\u202f"})
    void rejectsBlankOrNonliteralIds(String invalidId) {
        ObjectNode document = workspace();
        plan(document).put("id", invalidId);
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @Test
    void countsLiteralIdsInUnicodeCodePoints() {
        ObjectNode document = workspace();
        plan(document).put("id", "😀".repeat(80));
        assertDoesNotThrow(() -> validator.validate(document));
        plan(document).put("id", "😀".repeat(81));
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @Test
    void permitsIdenticalNestedIdsInIndependentPlansButNotCrossPlanReferences() {
        ObjectNode document = workspace();
        ((ArrayNode) document.get("plans")).add(plan(document).deepCopy().put("id", "second-plan"));
        assertDoesNotThrow(() -> validator.validate(document));
        ObjectNode secondIssue = (ObjectNode) document.at("/plans/1/issues/0");
        secondIssue.put("id", "only-in-second-plan");
        for (var target : document.at("/plans/1/activities")) {
            ((ObjectNode) target).set("issueIds", WorkspaceJson.array().add("only-in-second-plan"));
        }
        activity(document).set("issueIds", WorkspaceJson.array().add("only-in-second-plan"));
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @ParameterizedTest
    @MethodSource("invalidReferences")
    void rejectsInvalidOrNonliteralReferences(String pointer, String json) {
        ObjectNode document = workspace();
        ValidationFixtures.set(document, pointer, ValidationFixtures.value(json));
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    static Stream<Arguments> invalidReferences() {
        return Stream.of(
                Arguments.of("/plans/0/activities/0/streamId", "\"missing\""),
                Arguments.of("/plans/0/activities/0/streamId", "\" stream-alpha\""),
                Arguments.of("/plans/0/activities/0/streamId", "null"),
                Arguments.of("/plans/0/activities/0/typeId", "\"type-minimal \""),
                Arguments.of("/plans/0/activities/0/typeId", "[]"),
                Arguments.of("/plans/0/activities/0/issueIds", "null"),
                Arguments.of("/plans/0/activities/0/issueIds", "[true]"),
                Arguments.of("/plans/0/activities/0/issueIds", "[\"issue-shared-blocker \"]"),
                Arguments.of("/plans/0/activities/0/issueIds", "[\"issue-shared-blocker\",\"issue-shared-blocker\"]"),
                Arguments.of("/plans/0/issues/0/streamIds", "null"),
                Arguments.of("/plans/0/issues/0/streamIds", "[{}]"),
                Arguments.of("/plans/0/issues/0/activityIds", "null"),
                Arguments.of("/plans/0/issues/0/activityIds", "[\"missing\"]"),
                Arguments.of("/plans/0/activities/0/dependsOn", "false"),
                Arguments.of("/plans/0/activities/0/dependsOn", "\"activity-alpha-minimal\""),
                Arguments.of("/plans/0/activities/0/dependsOn", "\"activity-beta-minimal\""),
                Arguments.of("/plans/0/activities/0/dependsOn", "\"activity-alpha-heavy \""),
                Arguments.of("/plans/0/streams/0/dependsOn", "true"),
                Arguments.of("/plans/0/streams/0/dependsOn", "\"stream-alpha\""),
                Arguments.of("/plans/0/streams/0/dependsOn", "\"missing\""));
    }

    @Test
    void validatesAllThreeExplicitIssueScopes() {
        ObjectNode document = workspace();
        ObjectNode issue = issue(document);
        issue.set("activityIds", WorkspaceJson.array());
        assertDoesNotThrow(() -> validator.validate(document));
        issue.put("scope", "STREAMS");
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
        issue.set("streamIds", WorkspaceJson.array().add("stream-alpha"));
        assertDoesNotThrow(() -> validator.validate(document));
        issue.set("streamIds", WorkspaceJson.array().add("stream-alpha").add("stream-alpha"));
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
        issue.set("streamIds", WorkspaceJson.array());
        issue.put("scope", "ACTIVITIES");
        assertDoesNotThrow(() -> validator.validate(document));
        issue.set("activityIds", WorkspaceJson.array().add("activity-alpha-minimal"));
        assertDoesNotThrow(() -> validator.validate(document));
        issue.set("activityIds", WorkspaceJson.array().add("activity-alpha-minimal").add("activity-alpha-minimal"));
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
        issue.remove("activityIds");
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @ParameterizedTest
    @ValueSource(strings = {"streams", "activities"})
    void rejectsDependencyCycles(String collection) {
        ObjectNode document = workspace();
        ArrayNode items = (ArrayNode) plan(document).get(collection);
        ((ObjectNode) items.get(0)).put("dependsOn", items.get(1).get("id").textValue());
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @Test
    void rejectsEmptyPredecessorStreamWithoutSchedulingOrRewritingStarts() {
        ObjectNode document = workspace();
        plan(document).withArray("streams").add(WorkspaceJson.object()
                .put("id", "empty-stream").put("name", "Empty").put("description", ""));
        ((ObjectNode) plan(document).get("streams").get(0)).put("dependsOn", "empty-stream");
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @Test
    void validatesMaximumLengthDependencyChainsIteratively() {
        ObjectNode document = workspace();
        ArrayNode activities = (ArrayNode) plan(document).get("activities");
        ObjectNode prototype = activity(document).deepCopy();
        activities.removeAll();
        for (int index = 0; index < 499; index++) {
            ObjectNode next = prototype.deepCopy().put("id", "chain-" + index);
            if (index > 0) {
                next.put("dependsOn", "chain-" + (index - 1));
            }
            activities.add(next);
        }
        activities.add(prototype.deepCopy().put("id", "other-stream").put("streamId", "stream-beta"));
        assertDoesNotThrow(() -> validator.validate(document));
        ((ObjectNode) activities.get(0)).put("dependsOn", "chain-498");
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }
}
