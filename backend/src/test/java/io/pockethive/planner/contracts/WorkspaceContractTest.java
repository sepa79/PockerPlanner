package io.pockethive.planner.contracts;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.commands.PlanCollection;
import io.pockethive.planner.commands.WorkspaceCommands;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.RevisionConflict;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.persistence.WorkspaceStore;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.io.TempDir;

class WorkspaceContractTest {
    @TempDir Path temporary;

    @TestFactory
    List<DynamicTest> sharedLanguageNeutralCases() throws IOException {
        ObjectNode contracts = resource("workspace-regressions.json");
        ObjectNode workspace = resource(contracts.get("workspace").textValue());
        List<DynamicTest> tests = new ArrayList<>();
        contracts.get("cases").properties().forEach(entry -> tests.add(DynamicTest.dynamicTest(
                entry.getKey(), () -> runCase(entry.getKey(), entry.getValue(), contracts, workspace))));
        assertEquals(8, tests.size(), "Every language-neutral case must be exercised");
        return tests;
    }

    private void runCase(String name, JsonNode steps, ObjectNode contracts, ObjectNode workspace) {
        Path database = temporary.resolve(name + ".sqlite3");
        WorkspaceValidator validator = new WorkspaceValidator();
        JsonNode initialize = contracts.get("initialize");
        WorkspaceStore store = store(database, initialize.get("now"), validator);
        assertEquals(WorkspaceJson.object().put("schemaVersion", 1).put("revision", 0)
                .set("plans", WorkspaceJson.array()), store.read());
        ObjectNode expected = FixturePatches.apply(workspace, initialize.get("expected").get("workspacePatch"));
        assertEquals(expected, store.write(workspace));
        for (JsonNode step : steps) {
            store = store(database, step.get("now"), validator);
            WorkspaceCommands commands = new WorkspaceCommands(store, validator);
            ObjectNode before = store.read();
            expected = FixturePatches.apply(expected, step.get("expected").get("workspacePatch"));
            WorkspaceStore activeStore = store;
            switch (step.get("expected").get("status").textValue()) {
                case "OK" -> assertEquals(expected, execute(step, commands, activeStore), step.get("name").textValue());
                case "INVALID_INPUT" -> assertThrows(InvalidWorkspace.class, () -> execute(step, commands, activeStore));
                case "REVISION_CONFLICT" -> assertThrows(RevisionConflict.class, () -> execute(step, commands, activeStore));
                default -> throw new AssertionError("Unknown fixture status");
            }
            assertEquals(expected, store.read(), step.get("name").textValue());
            assertEquals(expected.get("revision").bigIntegerValue(), store.readRevision());
            if (!step.get("expected").get("status").asText().equals("OK")) {
                assertEquals(before, store.read(), "Rejected command must leave state exactly unchanged");
            }
        }
    }

    private ObjectNode execute(JsonNode step, WorkspaceCommands commands, WorkspaceStore store) {
        JsonNode arguments = step.get("arguments");
        return switch (step.get("operation").textValue()) {
            case "write_workspace" -> store.write(FixturePatches.apply(store.read(), arguments.get("patch")));
            case "update_plan_item" -> commands.updateItem(arguments.get("plan_id").textValue(),
                    PlanCollection.from(arguments.get("collection").textValue()), arguments.get("item_id").textValue(),
                    (ObjectNode) arguments.get("changes"), arguments.get("expected_revision").bigIntegerValue());
            default -> throw new AssertionError("Unknown fixture operation");
        };
    }

    private WorkspaceStore store(Path database, JsonNode now, WorkspaceValidator validator) {
        return new WorkspaceStore(database, Clock.fixed(Instant.parse(now.textValue()), ZoneOffset.UTC), validator);
    }

    private ObjectNode resource(String name) throws IOException {
        try (var input = getClass().getResourceAsStream("/contracts/" + name)) {
            if (input == null) {
                throw new AssertionError("Missing synthetic contract resource: " + name);
            }
            return WorkspaceJson.parse(input.readAllBytes());
        }
    }
}
