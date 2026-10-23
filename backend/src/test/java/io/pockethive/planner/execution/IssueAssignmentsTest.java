package io.pockethive.planner.execution;

import static io.pockethive.planner.execution.ExecutionTestDocuments.activity;
import static io.pockethive.planner.execution.ExecutionTestDocuments.issue;
import static io.pockethive.planner.execution.ExecutionTestDocuments.plan;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.io.IOException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class IssueAssignmentsTest {
    private final WorkspaceValidator validator = new WorkspaceValidator();
    private ObjectNode document;

    @BeforeEach
    void loadSyntheticWorkspace() throws IOException {
        document = ExecutionTestDocuments.workspace();
    }

    @Test
    void unlinkingFromAllNarrowsOnlyThatIssueAndPreservesOtherAssignments() {
        ObjectNode original = issue(document).deepCopy();
        ObjectNode otherActivity = (ObjectNode) plan(document).path("activities").get(1);
        JsonNode otherLinks = otherActivity.path("issueIds").deepCopy();
        activity(document).set("issueIds", WorkspaceJson.array());
        IssueAssignments.assign(plan(document), activity(document));
        assertEquals("ACTIVITIES", issue(document).path("scope").textValue());
        assertEquals(WorkspaceJson.array().add("activity-alpha-heavy").add("activity-beta-minimal"),
                issue(document).path("activityIds"));
        assertEquals(WorkspaceJson.array(), issue(document).path("streamIds"));
        assertEquals(otherLinks, otherActivity.path("issueIds"));
        original.put("scope", "ACTIVITIES");
        original.set("activityIds", issue(document).get("activityIds"));
        assertEquals(original, issue(document));
        validator.validate(document);
    }

    @Test
    void unlinkingFromStreamsKeepsOnlyPreviouslyAffectedOtherActivities() {
        issue(document).put("scope", "STREAMS");
        issue(document).set("streamIds", WorkspaceJson.array().add("stream-alpha"));
        activity(document).set("issueIds", WorkspaceJson.array());
        IssueAssignments.assign(plan(document), activity(document));
        assertEquals(WorkspaceJson.array().add("activity-alpha-heavy"), issue(document).path("activityIds"));
        assertFalse(IssueAssignments.affects(issue(document), activity(document)));
        assertTrue(IssueAssignments.affects(issue(document), plan(document).path("activities").get(1)));
        assertFalse(IssueAssignments.affects(issue(document), plan(document).path("activities").get(2)));
        validator.validate(document);
    }

    @Test
    void linkingOutsideStreamScopeAddsOnlyTheRequestedActivity() {
        issue(document).put("scope", "STREAMS");
        issue(document).set("streamIds", WorkspaceJson.array().add("stream-beta"));
        IssueAssignments.assign(plan(document), activity(document));
        assertEquals(WorkspaceJson.array().add("activity-alpha-minimal").add("activity-beta-minimal"),
                issue(document).path("activityIds"));
        assertEquals("ACTIVITIES", issue(document).path("scope").textValue());
        validator.validate(document);
    }

    @Test
    void noOpAssignmentsPreserveBroadScopeAndAbsentOptionalFields() {
        ObjectNode before = document.deepCopy();
        IssueAssignments.assign(plan(document), activity(document));
        assertEquals(before, document);
        assertFalse(issue(document).has("activityIds"));
    }

    @Test
    void emptyExplicitScopeAffectsNothingAndCanReceiveOneAssignment() {
        issue(document).put("scope", "ACTIVITIES");
        issue(document).set("activityIds", WorkspaceJson.array());
        for (JsonNode candidate : plan(document).path("activities")) {
            assertFalse(IssueAssignments.affects(issue(document), candidate));
        }
        IssueAssignments.assign(plan(document), activity(document));
        assertEquals(WorkspaceJson.array().add("activity-alpha-minimal"), issue(document).path("activityIds"));
        validator.validate(document);
    }

    @Test
    void narrowingPreservesClosedIssueAndHistoricalResolutionFacts() {
        issue(document).put("open", false);
        issue(document).put("blocker", false);
        issue(document).put("resolvedAt", "2026-01-06T09:00:00+01:00");
        activity(document).set("issueIds", WorkspaceJson.array());
        assertTrue(IssueAssignments.affects(issue(document), activity(document)));
        IssueAssignments.assign(plan(document), activity(document));
        assertFalse(issue(document).path("open").booleanValue());
        assertFalse(issue(document).path("blocker").booleanValue());
        assertEquals("2026-01-06T09:00:00+01:00", issue(document).path("resolvedAt").textValue());
    }

    @Test
    void removingLastExplicitAssignmentLeavesAnEmptyExplicitScope() {
        issue(document).put("scope", "ACTIVITIES");
        issue(document).set("activityIds", WorkspaceJson.array().add("activity-alpha-minimal"));
        activity(document).set("issueIds", WorkspaceJson.array());
        IssueAssignments.assign(plan(document), activity(document));
        assertEquals("ACTIVITIES", issue(document).path("scope").textValue());
        assertTrue(issue(document).path("activityIds").isEmpty());
        validator.validate(document);
    }

    @Test
    void invalidScopeFailsInsteadOfFallingBackToAnAssignmentMode() {
        issue(document).put("scope", "UNKNOWN");
        assertThrows(InvalidWorkspace.class, () -> IssueAssignments.affects(issue(document), activity(document)));
    }
}
