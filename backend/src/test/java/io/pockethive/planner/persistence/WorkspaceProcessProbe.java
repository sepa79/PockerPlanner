package io.pockethive.planner.persistence;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.commands.PlanCollection;
import io.pockethive.planner.commands.WorkspaceCommands;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.math.BigInteger;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

public final class WorkspaceProcessProbe {
    private WorkspaceProcessProbe() {}

    public static void main(String[] arguments) throws Exception {
        WorkspaceValidator validator = new WorkspaceValidator();
        WorkspaceStore store = new WorkspaceStore(Path.of(arguments[1]),
                Clock.fixed(Instant.parse("2026-01-08T09:00:00Z"), ZoneOffset.UTC), validator);
        if (arguments[0].equals("write")) {
            if (!store.readRevision().equals(BigInteger.ZERO)) {
                throw new AssertionError("Synthetic process probe requires an empty store");
            }
            try (var input = WorkspaceProcessProbe.class.getResourceAsStream("/contracts/workspace.json")) {
                store.write(WorkspaceJson.parse(input.readAllBytes()));
            }
            WorkspaceCommands commands = new WorkspaceCommands(store, validator);
            commands.updateItem("contract-plan", PlanCollection.ACTIVITIES, "activity-alpha-minimal",
                    WorkspaceJson.object().put("started", true), BigInteger.ONE);
            commands.updateItem("contract-plan", PlanCollection.ACTIVITIES, "activity-alpha-minimal",
                    WorkspaceJson.object().put("progress", 100).put("done", true), BigInteger.TWO);
        } else if (arguments[0].equals("read")) {
            ObjectNode saved = store.read();
            if (!store.readRevision().equals(BigInteger.valueOf(3))
                    || saved.at("/plans/0/activities/0/progress").intValue() != 100
                    || !saved.at("/plans/0/activities/0/startedAt").textValue().equals("2026-01-08T09:00:00Z")
                    || !saved.at("/plans/0/activities/0/completedAt").textValue().equals("2026-01-08T09:00:00Z")
                    || !saved.at("/plans/0/activities/0/blockerIntervals/0/endedAt").textValue().equals("2026-01-08T09:00:00Z")) {
                throw new AssertionError("A new JVM did not read the committed lifecycle facts");
            }
        } else {
            throw new AssertionError("Unknown synthetic process probe operation");
        }
        System.out.println("Synthetic SQLite process probe passed: " + arguments[0]);
    }
}
