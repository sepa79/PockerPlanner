package io.pockethive.planner.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.http.ApiFailure;
import io.pockethive.planner.persistence.WorkspaceStore;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.nio.file.Path;
import java.time.Clock;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PlannerCatalogueTest {
    @TempDir Path temporary;
    private WorkspaceStore store;
    private ObjectNode saved;
    private PlannerCatalogue catalogue;

    @BeforeEach
    void initialize() throws Exception {
        store = new WorkspaceStore(temporary.resolve("catalogue.sqlite3"), Clock.systemUTC(), new WorkspaceValidator());
        saved = store.write(IntegrationDocuments.workspace());
        catalogue = new PlannerCatalogue(store, "qa");
    }

    @Test
    void projectsOnlyTheContractFieldsAndCannotMutateCanonicalState() {
        ObjectNode result = catalogue.catalogue();
        assertEquals(Set.of("schemaVersion", "instanceId", "revision", "plans"), keys(result));
        assertEquals(1, result.get("schemaVersion").intValue());
        assertEquals("qa", result.get("instanceId").textValue());
        assertEquals(saved.get("revision"), result.get("revision"));
        var plan = (ObjectNode) result.at("/plans/0");
        assertEquals(Set.of("id", "name", "testPlan", "streams", "activities"), keys(plan));
        assertEquals("pp:qa:contract-plan", plan.get("testPlan").textValue());
        assertEquals(Set.of("id", "name"), keys((ObjectNode) plan.at("/streams/0")));
        assertEquals(Set.of("id", "name", "streamId", "tag"), keys((ObjectNode) plan.at("/activities/0")));
        assertEquals("pp.activity:8SNVa7rPg60uMbyvj0nQKIgB6pjN-jwKGPzz8JQPEdw", plan.at("/activities/0/tag").textValue());
        assertEquals(saved, store.read());
        plan.put("name", "Caller changed projection");
        result.withArray("plans").removeAll();
        assertEquals(saved, store.read());
        assertEquals("Synthetic contract plan", catalogue.catalogue().at("/plans/0/name").textValue());
    }

    @Test
    void renamingAndCurrentStreamMembershipDoNotChangeIdentity() {
        ObjectNode before = catalogue.catalogue();
        ObjectNode changed = store.read();
        ((ObjectNode) changed.at("/plans/0")).put("name", "Renamed plan");
        ((ObjectNode) changed.at("/plans/0/streams/0")).put("name", "Renamed stream");
        ((ObjectNode) changed.at("/plans/0/activities/2")).put("name", "Renamed activity").put("streamId", "stream-alpha");
        ObjectNode next = store.write(changed);
        ObjectNode after = catalogue.catalogue();
        assertEquals(before.at("/plans/0/testPlan"), after.at("/plans/0/testPlan"));
        assertEquals(before.at("/plans/0/activities/2/tag"), after.at("/plans/0/activities/2/tag"));
        assertEquals("stream-alpha", after.at("/plans/0/activities/2/streamId").textValue());
        assertEquals("Renamed plan", after.at("/plans/0/name").textValue());
        assertEquals(next, store.read());
    }

    @Test
    void literalPlanIdsAndDeploymentInstanceScopeAreNotNormalized() {
        String id = "literal:plan/ą🐝";
        ObjectNode changed = store.read();
        ((ObjectNode) changed.at("/plans/0")).put("id", id);
        store.write(changed);
        assertEquals("pp:qa:" + id, catalogue.catalogue().at("/plans/0/testPlan").textValue());
        assertNotEquals(catalogue.catalogue().at("/plans/0/activities/0/tag"),
            new PlannerCatalogue(store, "other").catalogue().at("/plans/0/activities/0/tag"));
    }

    @Test
    void configurationIsValidatedOnUseAndAnEmptyWorkspaceIsNotAConfigFallback() {
        PlannerCatalogue missing = new PlannerCatalogue(store, "");
        PhApiClient missingPh = new PhApiClient("");
        new LinkedRuns(missing, missingPh, "");
        assertEquals(503, assertThrows(ApiFailure.class, missing::catalogue).status());
        ObjectNode empty = store.read();
        empty.withArray("plans").removeAll();
        store.write(empty);
        assertEquals(0, catalogue.catalogue().get("plans").size());
        assertThrows(ApiFailure.class, missing::catalogue);
        assertTrue(store.readRevision().intValue() > 0);
    }

    private static Set<String> keys(ObjectNode node) {
        Set<String> keys = new HashSet<>();
        node.fieldNames().forEachRemaining(keys::add);
        return keys;
    }
}
