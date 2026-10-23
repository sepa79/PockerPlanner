package io.pockethive.planner.validation;

import static io.pockethive.planner.validation.ValidationFixtures.activity;
import static io.pockethive.planner.validation.ValidationFixtures.issue;
import static io.pockethive.planner.validation.ValidationFixtures.workspace;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class WorkspaceValuesTest {
    @ParameterizedTest
    @ValueSource(strings = {"null", "true", "false", "0.0", "50.0", "\"50\"", "[]", "{}", "-1", "101",
            "4294967296", "999999999999999999999999999999999999999999"})
    void rejectsNonIntegralOrOutOfRangeProgress(String json) {
        assertThrows(InvalidWorkspace.class, () -> WorkspaceValues.progress(ValidationFixtures.value(json)));
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 50, 99, 100})
    void acceptsExactProgressBoundaries(int progress) {
        assertEquals(progress, WorkspaceValues.progress(WorkspaceJson.object().put("value", progress).get("value")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"20261013", "2026-W42-2", "2026-1-03", "2026-02-30", "2026-10-13T00:00:00Z",
            " 2026-10-13", "2026-10-13 ", "٢٠٢٦-10-13", "0000-01-01", "2025-02-29"})
    void rejectsNoncanonicalOrInvalidCalendarDates(String date) {
        assertThrows(InvalidWorkspace.class,
                () -> WorkspaceValues.calendarDate(WorkspaceJson.object().put("value", date).get("value"), "Date"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"0001-01-01", "2028-02-29", "9999-12-31"})
    void acceptsCanonicalCalendarBounds(String date) {
        assertEquals(LocalDate.parse(date),
                WorkspaceValues.calendarDate(WorkspaceJson.object().put("value", date).get("value"), "Date"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not a date", "2026-01-05", "2026-01-05T10:00:00", "2026-1-05T10:00:00Z",
            "2026-01-05 10:00:00Z", "2026-01-05t10:00:00Z", "2026-01-05T10:00:00z", "2026-02-30T10:00:00Z",
            "2026-01-05T24:00:00Z", "2026-01-05T10:60:00Z", "2026-01-05T10:00:60Z", "2026-01-05T10:00Z",
            "2026-01-05T10:00:00+24:00", "2026-01-05T10:00:00+00:60", "2026-01-05T10:00:00+0100",
            "2026-01-05T10:00:00.1234567Z", "2026-01-05T10:00:00.Z", "0000-01-01T00:00:00Z",
            "٢٠٢٦-01-05T10:00:00Z", "2026-01-05T10:00:00Z "})
    void rejectsUnsupportedTimestampLexemes(String timestamp) {
        assertThrows(InvalidWorkspace.class,
                () -> WorkspaceValues.timestamp(WorkspaceJson.object().put("value", timestamp).get("value"), "Timestamp"));
    }

    @ParameterizedTest
    @CsvSource({"2026-01-05T10:00:00Z,2026-01-05T10:00:00Z",
            "2026-01-05T10:00:00.1+01:00,2026-01-05T09:00:00.100Z",
            "2026-01-05T10:00:00.123456-03:30,2026-01-05T13:30:00.123456Z",
            "2026-01-05T10:00:00+23:59,2026-01-04T10:01:00Z",
            "2026-01-05T10:00:00-23:59,2026-01-06T09:59:00Z",
            "2026-01-05T10:00:00-00:00,2026-01-05T10:00:00Z"})
    void comparesSupportedTimestampsAsInstantsWithoutRewritingText(String timestamp, String expected) {
        ObjectNode original = WorkspaceJson.object().put("value", timestamp);
        assertEquals(Instant.parse(expected), WorkspaceValues.timestamp(original.get("value"), "Timestamp"));
        assertEquals(timestamp, original.get("value").textValue());
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "true", "1000", "[]", "{}"})
    void rejectsNonstringsInDateTimestampAndTextHelpers(String json) {
        assertThrows(InvalidWorkspace.class, () -> WorkspaceValues.timestamp(ValidationFixtures.value(json), "Timestamp"));
        assertThrows(InvalidWorkspace.class, () -> WorkspaceValues.calendarDate(ValidationFixtures.value(json), "Date"));
        assertThrows(InvalidWorkspace.class, () -> WorkspaceValues.text(ValidationFixtures.value(json), "Text", 80, true));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "https://jira.example.test/browse/TEST-1", "HTTPS://jira.example.test/browse/TEST-1",
            "https://[::1]:8443/browse/TEST-1", "https://jira.example.test/browse/żółć?label=🤔",
            "https://jira.example.test/path%20with%20spaces", "https://jira.example.test:8443/path",
            "  https://jira.example.test/browse/TEST-1  "})
    void acceptsOptionalHttpsLinksWithoutNormalizingThem(String link) {
        ObjectNode document = workspace();
        activity(document).put("jiraUrl", link);
        issue(document).put("jiraUrl", link);
        assertDoesNotThrow(() -> new WorkspaceValidator().validate(document));
        assertEquals(link, activity(document).get("jiraUrl").textValue());
    }

    @ParameterizedTest
    @ValueSource(strings = {"http://jira.example.test", "javascript:alert(1)", "//jira.example.test", "https:/jira.example.test",
            "https://", "https:///ticket", "https://user@jira.example.test", "https://user:password@jira.example.test",
            "https://:password@jira.example.test", "https://[", "https://[bogus]/path", "https://[::1]invalid/path",
            "https://[vwrong]/path", "https://jira／example.test/path", "https://jira.example.test/path with spaces",
            "https://jira.example.test/invalid%path", "https://jira.example.test:custom-port/path",
            "https://jira.example.test/path|segment", "https://@jira.example.test/path",
            "https://:@jira.example.test/path", "https://[v1.name]/path", "https://jira.example.test:99999/path"})
    void rejectsNonHttpsAuthoritiesAndCredentials(String link) {
        ObjectNode document = workspace();
        activity(document).put("jiraUrl", link);
        assertThrows(InvalidWorkspace.class, () -> new WorkspaceValidator().validate(document));
    }

    @Test
    void validatesJiraLinksAgainstTheExistingTextLengthLimit() {
        ObjectNode document = workspace();
        String prefix = "https://jira.example.test/";
        activity(document).put("jiraUrl", prefix + "x".repeat(1000 - prefix.length()));
        assertDoesNotThrow(() -> new WorkspaceValidator().validate(document));
        activity(document).put("jiraUrl", activity(document).get("jiraUrl").textValue() + "x");
        assertThrows(InvalidWorkspace.class, () -> new WorkspaceValidator().validate(document));
    }

    @Test
    void helpersRejectMissingValuesWithDomainFailures() {
        assertThrows(InvalidWorkspace.class, () -> WorkspaceValues.text(null, "Text", 80, true));
        assertThrows(InvalidWorkspace.class, () -> WorkspaceValues.calendarDate(null, "Date"));
        assertThrows(InvalidWorkspace.class, () -> WorkspaceValues.timestamp(null, "Timestamp"));
        assertThrows(InvalidWorkspace.class, () -> WorkspaceValues.progress(null));
    }
}
