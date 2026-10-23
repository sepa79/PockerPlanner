package io.pockethive.planner.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.http.ApiFailure;
import io.pockethive.planner.persistence.WorkspaceStore;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Clock;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class LinkedRunsTest {
    @TempDir Path temporary;
    private WorkspaceStore store;
    private ObjectNode saved;
    private PlannerCatalogue catalogue;

    @BeforeEach
    void initialize() throws Exception {
        store = new WorkspaceStore(temporary.resolve("runs.sqlite3"), Clock.systemUTC(), new WorkspaceValidator());
        saved = store.write(IntegrationDocuments.workspace());
        catalogue = new PlannerCatalogue(store, "qa");
    }

    @Test
    void matchesExactPlanAndTagsAcrossStreamsKeepingUnresolvedReferencesAndHistoricalIdentity() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            ObjectNode row = row(0);
            row.withArray("tags").add(catalogue.catalogue().at("/plans/0/activities/2/tag").textValue())
                .add("pp.activity:deleted-reference").add("pp.activity:deleted-reference").add("operator-tag");
            ObjectNode unrelated = row.deepCopy().put("testPlan", "pp:other:contract-plan");
            ObjectNode prefix = row.deepCopy().put("testPlan", "pp:qa:contract-plan-extra");
            ObjectNode similarTag = row.deepCopy().put("runId", "other historical run");
            similarTag.putArray("tags").add(row.at("/tags/0").textValue() + "extra");
            reply(ph, List.of(row, unrelated, prefix, similarTag));
            ObjectNode result = linked(ph).read("contract-plan", "Bearer viewer");
            assertEquals(saved.get("revision"), result.get("revision"));
            assertEquals(false, result.get("limitReached").booleanValue());
            assertEquals(2, result.get("runs").size());
            JsonNode run = result.at("/runs/0");
            assertEquals("swarm/one", run.get("swarmId").textValue());
            assertEquals("old run", run.get("runId").textValue());
            assertEquals("scenario", run.get("scenarioId").textValue());
            assertEquals("[\"activity-alpha-minimal\",\"activity-beta-minimal\"]", run.get("activityIds").toString());
            assertEquals(2, run.get("unresolvedActivityTags").size());
            assertEquals("https://ph.example/base/journal/swarms/swarm%2Fone?runId=old%20run", run.get("journalUrl").textValue());
            assertEquals(0, result.at("/runs/1/activityIds").size());
            assertEquals(1, result.at("/runs/1/unresolvedActivityTags").size());
            assertEquals("/orchestrator/api/journal/swarm/runs?limit=5000", ph.last().get("path"));
            assertEquals("Bearer viewer", ph.last().get("authorization"));
            assertEquals(saved, store.read());
        }
    }

    @Test
    void encodesExactSwarmAndRunIdentityAndAllowsAnAbsentScenarioWithoutGuessing() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            ObjectNode row = row(0).put("swarmId", "a/%2F ?#\\ą🐝").put("runId", "historical/+?&=#%ą🐝");
            row.remove("scenarioId");
            reply(ph, List.of(row));
            JsonNode result = linked(ph).read("contract-plan", "Bearer viewer").at("/runs/0");
            assertEquals(row.get("swarmId"), result.get("swarmId"));
            assertEquals(row.get("runId"), result.get("runId"));
            assertEquals("https://ph.example/base/journal/swarms/a%2F%252F%20%3F%23%5C%C4%85%F0%9F%90%9D"
                + "?runId=historical%2F%2B%3F%26%3D%23%25%C4%85%F0%9F%90%9D", result.get("journalUrl").textValue());
            assertTrue(result.get("scenarioId").isNull());
            assertEquals(saved, store.read());
        }
    }

    @Test
    void aDeletedActivityStaysUnresolvedAndNeverMatchesByNameOrNewMembership() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            ObjectNode row = row(2);
            ObjectNode changed = store.read();
            ((com.fasterxml.jackson.databind.node.ArrayNode) changed.at("/plans/0/activities")).remove(2);
            ObjectNode latest = store.write(changed);
            reply(ph, List.of(row));
            ObjectNode result = linked(ph).read("contract-plan", "Bearer viewer");
            assertEquals(latest.get("revision"), result.get("revision"));
            assertEquals(0, result.at("/runs/0/activityIds").size());
            assertEquals(row.at("/tags/0"), result.at("/runs/0/unresolvedActivityTags/0"));
            assertEquals(latest, store.read());
        }
    }

    @Test
    void retainsTheSingleSnapshotTakenBeforeTheNetworkCallEvenIfWorkspaceChangesDuringIt() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            ObjectNode row = row(2);
            ph.handle(exchange -> {
                ObjectNode changed = store.read();
                ((com.fasterxml.jackson.databind.node.ArrayNode) changed.at("/plans/0/activities")).remove(2);
                store.write(changed);
                FakePhIngress.reply(exchange, 200, "[" + row + "]");
            });
            ObjectNode result = linked(ph).read("contract-plan", "Bearer viewer");
            assertEquals(saved.get("revision"), result.get("revision"));
            assertEquals("activity-beta-minimal", result.at("/runs/0/activityIds/0").textValue());
            assertEquals(0, result.at("/runs/0/unresolvedActivityTags").size());
            assertEquals(saved.get("revision").intValue() + 1, store.readRevision().intValue());
            assertEquals(1, ph.calls());
        }
    }

    @Test
    void reportsTheFullListingCapEvenWhenRowsBelongToOtherPlansAndRejectsOverflow() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            String unlinked = "{\"testPlan\":\"other\"}";
            ph.reply(200, "[" + (unlinked + ",").repeat(4999) + unlinked + "]");
            ObjectNode result = linked(ph).read("contract-plan", "Bearer viewer");
            assertEquals(true, result.get("limitReached").booleanValue());
            assertEquals(0, result.get("runs").size());
            ph.reply(200, "[" + (unlinked + ",").repeat(5000) + unlinked + "]");
            assertEquals(503, assertThrows(ApiFailure.class, () -> linked(ph).read("contract-plan", "Bearer viewer")).status());
            assertEquals(saved, store.read());
        }
    }

    @Test
    void invalidSchemaNeverCoercesAFieldOrReturnsAnEmptyFallback() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            for (String body : List.of("{}", "[null]", "[\"row\"]", "[42]", "[{\"testPlan\":true}]",
                    "[{\"testPlan\":{}}]")) {
                ph.reply(200, body);
                assertEquals(503, assertThrows(ApiFailure.class, () -> linked(ph).read("contract-plan", "Bearer viewer")).status());
            }
            for (String field : List.of("swarmId", "runId", "tags", "scenarioId")) {
                ObjectNode invalid = row(0).put(field, 42);
                reply(ph, List.of(invalid));
                assertEquals(503, assertThrows(ApiFailure.class, () -> linked(ph).read("contract-plan", "Bearer viewer")).status());
            }
            for (String field : List.of("swarmId", "runId", "tags")) {
                ObjectNode invalid = row(0);
                invalid.remove(field);
                reply(ph, List.of(invalid));
                assertThrows(ApiFailure.class, () -> linked(ph).read("contract-plan", "Bearer viewer"));
                invalid.putNull(field);
                reply(ph, List.of(invalid));
                assertThrows(ApiFailure.class, () -> linked(ph).read("contract-plan", "Bearer viewer"));
            }
            ObjectNode invalid = row(0);
            invalid.putArray("tags").add(42);
            reply(ph, List.of(invalid));
            assertThrows(ApiFailure.class, () -> linked(ph).read("contract-plan", "Bearer viewer"));
            assertEquals(saved, store.read());
        }
    }

    @Test
    void unknownPlanAndMissingOrInvalidConfigurationFailBeforeNetworkAndDoNotBlockConstruction() throws Exception {
        try (FakePhIngress ph = new FakePhIngress()) {
            LinkedRuns linked = linked(ph);
            assertThrows(InvalidWorkspace.class, () -> linked.read("missing", "Bearer viewer"));
            assertThrows(InvalidWorkspace.class, () -> linked.read(" contract-plan", "Bearer viewer"));
            for (String publicUrl : new String[]{"", "file:///etc/passwd", "https://user@ph", "https://ph?token=secret", "https://ph#fragment"}) {
                LinkedRuns invalid = new LinkedRuns(catalogue, ph.client(), publicUrl);
                assertEquals(503, assertThrows(ApiFailure.class, () -> invalid.read("contract-plan", "Bearer viewer")).status());
            }
            LinkedRuns missingIngress = new LinkedRuns(catalogue, new PhApiClient(""), "https://ph.example");
            assertEquals(503, assertThrows(ApiFailure.class, () -> missingIngress.read("contract-plan", "Bearer viewer")).status());
            assertEquals(0, ph.calls());
            assertEquals(saved, store.read());
        }
    }

    private LinkedRuns linked(FakePhIngress ph) {
        return new LinkedRuns(catalogue, ph.client(), "https://ph.example/base/");
    }

    private ObjectNode row(int activity) {
        JsonNode plan = catalogue.catalogue().at("/plans/0");
        ObjectNode row = PhJson.object().put("swarmId", "swarm/one").put("runId", "old run")
            .put("scenarioId", "scenario").put("testPlan", plan.get("testPlan").textValue());
        row.putArray("tags").add(plan.at("/activities/" + activity + "/tag").textValue());
        return row;
    }

    private static void reply(FakePhIngress ph, List<ObjectNode> rows) {
        var array = new com.fasterxml.jackson.databind.node.ArrayNode(com.fasterxml.jackson.databind.node.JsonNodeFactory.instance);
        rows.forEach(array::add);
        ph.reply(200, new String(PhJson.encode(array), StandardCharsets.UTF_8));
    }
}
