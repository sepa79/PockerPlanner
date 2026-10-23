package io.pockethive.planner.validation;

import static io.pockethive.planner.validation.ValidationFixtures.activity;
import static io.pockethive.planner.validation.ValidationFixtures.issue;
import static io.pockethive.planner.validation.ValidationFixtures.plan;
import static io.pockethive.planner.validation.ValidationFixtures.workspace;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

class WorkspaceValidatorTest {
    private final WorkspaceValidator validator = new WorkspaceValidator();

    @Test
    void validatesSyntheticContractWithoutChangingAnything() {
        ObjectNode document = workspace();
        ObjectNode before = document.deepCopy();
        byte[] serialized = WorkspaceJson.encode(document);
        validator.validate(document);
        assertEquals(before, document);
        assertArrayEquals(serialized, WorkspaceJson.encode(document));
    }

    @Test
    void retainsAbsenceNullAndSupportedExtensionFieldsWithoutNormalizingText() {
        ObjectNode document = workspace();
        plan(document).putNull("deadline");
        ((ObjectNode) plan(document).get("streams").get(0)).putNull("dependsOn");
        ((ObjectNode) plan(document).get("activityTypes").get(0)).set("extension", ValidationFixtures.value("{\"note\":null}"));
        ObjectNode activity = activity(document);
        activity.put("name", "  Untrimmed label  ");
        activity.putNull("dependsOn");
        activity.putNull("startedAt");
        activity.putNull("completedAt");
        activity.putNull("blockerTrackingSince");
        activity.set("blockerIntervals", WorkspaceJson.array());
        activity.set("extension", ValidationFixtures.value("[null,42,true,{\"field\":\"kept\"}]"));
        ObjectNode issue = issue(document);
        issue.putNull("resolvedAt");
        issue.put("extension", "preserved");
        ObjectNode before = document.deepCopy();
        validator.validate(document);
        assertEquals(before, document);
        assertEquals("  Untrimmed label  ", activity.get("name").textValue());
        assertEquals(false, document.at("/plans/0/activities/1").has("includeWeekends"));
    }

    @Test
    void acceptsEmptyWorkspaceAndEmptyPlanCollections() {
        assertDoesNotThrow(() -> validator.validate(ValidationFixtures.value("{\"schemaVersion\":1,\"revision\":0,\"plans\":[]}")));
        ObjectNode document = workspace();
        for (String collection : new String[] {"streams", "activityTypes", "activities", "issues"}) {
            plan(document).set(collection, WorkspaceJson.array());
        }
        assertDoesNotThrow(() -> validator.validate(document));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "true", "1", "\"workspace\"", "[]", "{}",
            "{\"schemaVersion\":1,\"revision\":0,\"plans\":[],\"extra\":true}"})
    void rejectsInvalidWorkspaceShape(String json) {
        assertThrows(InvalidWorkspace.class, () -> validator.validate(ValidationFixtures.value(json)));
    }

    @Test
    void rejectsMissingDocument() {
        assertThrows(InvalidWorkspace.class, () -> validator.validate(null));
    }

    @ParameterizedTest
    @MethodSource("invalidScalarFields")
    void rejectsWrongScalarTypesAndBounds(String pointer, String json) {
        ObjectNode document = workspace();
        ValidationFixtures.set(document, pointer, ValidationFixtures.value(json));
        ObjectNode before = document.deepCopy();
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
        assertEquals(before, document);
    }

    static Stream<Arguments> invalidScalarFields() {
        return Stream.of(
                Arguments.of("/schemaVersion", "true"),
                Arguments.of("/schemaVersion", "\"1\""),
                Arguments.of("/schemaVersion", "1.0"),
                Arguments.of("/schemaVersion", "4294967297"),
                Arguments.of("/schemaVersion", "2"),
                Arguments.of("/revision", "false"),
                Arguments.of("/revision", "\"0\""),
                Arguments.of("/revision", "0.0"),
                Arguments.of("/revision", "-1"),
                Arguments.of("/plans/0/name", "null"),
                Arguments.of("/plans/0/name", "\"   \""),
                Arguments.of("/plans/0/description", "false"),
                Arguments.of("/plans/0/streams/0/name", "[]"),
                Arguments.of("/plans/0/streams/0/description", "null"),
                Arguments.of("/plans/0/activityTypes/0/name", "42"),
                Arguments.of("/plans/0/activityTypes/0/color", "null"),
                Arguments.of("/plans/0/activityTypes/0/color", "\"#abc\""),
                Arguments.of("/plans/0/activityTypes/0/color", "\"#12345g\""),
                Arguments.of("/plans/0/activities/0/name", "false"),
                Arguments.of("/plans/0/activities/0/status", "[]"),
                Arguments.of("/plans/0/activities/0/durationDays", "true"),
                Arguments.of("/plans/0/activities/0/durationDays", "3.0"),
                Arguments.of("/plans/0/activities/0/durationDays", "\"3\""),
                Arguments.of("/plans/0/activities/0/durationDays", "0"),
                Arguments.of("/plans/0/activities/0/durationDays", "366"),
                Arguments.of("/plans/0/activities/0/durationDays", "4294967297"),
                Arguments.of("/plans/0/activities/0/includeWeekends", "null"),
                Arguments.of("/plans/0/activities/0/includeWeekends", "0"),
                Arguments.of("/plans/0/activities/0/includeWeekends", "\"false\""),
                Arguments.of("/plans/0/issues/0/title", "{}"),
                Arguments.of("/plans/0/issues/0/description", "null"),
                Arguments.of("/plans/0/issues/0/open", "1"),
                Arguments.of("/plans/0/issues/0/blocker", "\"true\""),
                Arguments.of("/plans/0/issues/0/descriptionIncomplete", "null"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/schemaVersion", "/revision", "/plans", "/plans/0/name", "/plans/0/description",
            "/plans/0/streams", "/plans/0/activityTypes", "/plans/0/activities", "/plans/0/issues",
            "/plans/0/streams/0/id", "/plans/0/streams/0/name", "/plans/0/streams/0/description",
            "/plans/0/activityTypes/0/id", "/plans/0/activityTypes/0/name", "/plans/0/activityTypes/0/color",
            "/plans/0/activities/0/name", "/plans/0/activities/0/status", "/plans/0/activities/0/jiraUrl",
            "/plans/0/activities/0/streamId", "/plans/0/activities/0/typeId", "/plans/0/activities/0/start",
            "/plans/0/activities/0/durationDays", "/plans/0/activities/0/progress", "/plans/0/activities/0/issueIds",
            "/plans/0/issues/0/title", "/plans/0/issues/0/description", "/plans/0/issues/0/scope",
            "/plans/0/issues/0/streamIds", "/plans/0/issues/0/blocker", "/plans/0/issues/0/discovered",
            "/plans/0/issues/0/open", "/plans/0/issues/0/descriptionIncomplete", "/plans/0/issues/0/jiraUrl"})
    void rejectsMissingRequiredFields(String pointer) {
        ObjectNode document = workspace();
        ValidationFixtures.remove(document, pointer);
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @ParameterizedTest
    @CsvSource({"/plans/0/name,160", "/plans/0/description,12000", "/plans/0/streams/0/name,100",
            "/plans/0/streams/0/description,2000", "/plans/0/activityTypes/0/name,80",
            "/plans/0/activities/0/name,160", "/plans/0/activities/0/status,1000",
            "/plans/0/issues/0/title,160", "/plans/0/issues/0/description,2000"})
    void countsTextLimitsInUnicodeCodePoints(String pointer, int maximum) {
        ObjectNode document = workspace();
        ValidationFixtures.set(document, pointer, WorkspaceJson.object().put("value", "😀".repeat(maximum)).get("value"));
        assertDoesNotThrow(() -> validator.validate(document));
        ValidationFixtures.set(document, pointer, WorkspaceJson.object().put("value", "😀".repeat(maximum + 1)).get("value"));
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/plans/0", "/plans/0/streams/0"})
    void rejectsUnsupportedFieldsWhereCurrentContractIsClosed(String pointer) {
        ObjectNode document = workspace();
        ((ObjectNode) document.at(pointer)).put("unknown", "not supported");
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @ParameterizedTest
    @ValueSource(strings = {"started", "done"})
    void rejectsTransientLifecycleActionsEvenWhenNull(String field) {
        ObjectNode document = workspace();
        activity(document).putNull(field);
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @ParameterizedTest
    @CsvSource({"plans,100", "streams,500", "activityTypes,500", "activities,500", "issues,500"})
    void enforcesEachCollectionLimitAtItsBoundary(String collection, int maximum) {
        ObjectNode document = workspace();
        ArrayNode items = (ArrayNode) (collection.equals("plans") ? document.get(collection) : plan(document).get(collection));
        ObjectNode prototype = ((ObjectNode) items.get(0)).deepCopy();
        while (items.size() < maximum) {
            ObjectNode next = prototype.deepCopy();
            next.put("id", "synthetic-" + items.size());
            items.add(next);
        }
        assertDoesNotThrow(() -> validator.validate(document));
        items.add(prototype.deepCopy().put("id", "one-too-many"));
        assertThrows(InvalidWorkspace.class, () -> validator.validate(document));
    }

    @Test
    void acceptsArbitraryNonnegativeIntegralRevisionWithoutOverflow() {
        ObjectNode document = workspace();
        document.set("revision", ValidationFixtures.value("999999999999999999999999999999999999999999999"));
        assertDoesNotThrow(() -> validator.validate(document));
    }
}
