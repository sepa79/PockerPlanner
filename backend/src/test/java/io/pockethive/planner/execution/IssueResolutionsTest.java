package io.pockethive.planner.execution;

import static io.pockethive.planner.execution.ExecutionTestDocuments.issue;
import static io.pockethive.planner.execution.ExecutionTestDocuments.plan;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.WorkspaceJson;
import java.io.IOException;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class IssueResolutionsTest {
    private static final Instant NOW = Instant.parse("2026-01-12T10:00:00Z");
    private ObjectNode current;

    @BeforeEach
    void loadSyntheticWorkspace() throws IOException {
        current = ExecutionTestDocuments.workspace();
    }

    @Test
    void closingStampsInjectedTimeInsteadOfSuppliedResolution() {
        ObjectNode before = current.deepCopy();
        ObjectNode draft = current.deepCopy();
        issue(draft).put("open", false).put("resolvedAt", "2026-01-01T09:00:00Z");
        IssueResolutions.record(draft, current, NOW);
        assertEquals(NOW.toString(), issue(draft).path("resolvedAt").textValue());
        assertEquals(before, current);
    }

    @Test
    void repeatedClosePreservesOriginalLexicalTimestamp() {
        issue(current).put("open", false).put("resolvedAt", "2026-01-06T09:00:00.123456+01:00");
        ObjectNode draft = current.deepCopy();
        issue(draft).put("resolvedAt", NOW.toString());
        IssueResolutions.record(draft, current, NOW);
        assertEquals(issue(current), issue(draft));
        issue(draft).remove("resolvedAt");
        IssueResolutions.record(draft, current, NOW);
        assertEquals(issue(current), issue(draft));
    }

    @Test
    void reopeningClearsResolutionAndNextCloseUsesTheNewTransactionTime() {
        issue(current).put("open", false).put("resolvedAt", NOW.minusSeconds(3600).toString());
        ObjectNode reopened = current.deepCopy();
        issue(reopened).put("open", true);
        IssueResolutions.record(reopened, current, NOW);
        assertFalse(issue(reopened).has("resolvedAt"));
        ObjectNode closed = reopened.deepCopy();
        issue(closed).put("open", false);
        IssueResolutions.record(closed, reopened, NOW.plusSeconds(3600));
        assertEquals(NOW.plusSeconds(3600).toString(), issue(closed).path("resolvedAt").textValue());
    }

    @Test
    void importedClosedIssuesKeepHistoricalAndUnknownDatesWithoutInventedEvents() {
        ObjectNode historical = issue(current).deepCopy().put("id", "historical").put("open", false)
                .put("resolvedAt", "2026-01-06T09:00:00+01:00");
        ObjectNode absent = historical.deepCopy().put("id", "absent");
        absent.remove("resolvedAt");
        ObjectNode explicitNull = historical.deepCopy().put("id", "null").putNull("resolvedAt");
        ObjectNode draft = current.deepCopy();
        plan(draft).withArray("issues").add(historical).add(absent).add(explicitNull);
        IssueResolutions.record(draft, current, NOW);
        assertEquals(historical, plan(draft).path("issues").get(1));
        assertFalse(plan(draft).path("issues").get(2).has("resolvedAt"));
        assertTrue(plan(draft).path("issues").get(3).path("resolvedAt").isNull());
    }

    @Test
    void importedOpenIssuesCannotRetainAResolutionDate() {
        ObjectNode draft = current.deepCopy();
        issue(draft).put("id", "new-issue").putNull("resolvedAt");
        IssueResolutions.record(draft, current, NOW);
        assertFalse(issue(draft).has("resolvedAt"));
    }

    @Test
    void identicalIssueIdsAreScopedToTheirPlanAndAllClosesUseOneInstant() {
        ObjectNode second = plan(current).deepCopy().put("id", "second-plan");
        ((ObjectNode) second.path("issues").get(0)).put("open", false).put("resolvedAt", "2026-01-06T09:00:00Z");
        current.withArray("plans").add(second);
        ObjectNode draft = current.deepCopy();
        issue(draft).put("open", false);
        ObjectNode newlyClosed = issue(draft).deepCopy().put("id", "other-issue").put("open", true);
        plan(current).withArray("issues").add(newlyClosed);
        plan(draft).withArray("issues").add(newlyClosed.deepCopy().put("open", false));
        IssueResolutions.record(draft, current, NOW);
        assertEquals(NOW.toString(), issue(draft).path("resolvedAt").textValue());
        assertEquals(NOW.toString(), plan(draft).path("issues").get(1).path("resolvedAt").textValue());
        assertEquals("2026-01-06T09:00:00Z", draft.path("plans").get(1).path("issues").get(0).path("resolvedAt").textValue());
    }

    @Test
    void explicitReplacementHasNoPreviousLifecycleEventsToStamp() {
        ObjectNode empty = WorkspaceJson.object();
        empty.set("plans", WorkspaceJson.array());
        ObjectNode draft = current.deepCopy();
        issue(draft).put("open", false);
        IssueResolutions.record(draft, empty, NOW);
        assertFalse(issue(draft).has("resolvedAt"));
    }
}
