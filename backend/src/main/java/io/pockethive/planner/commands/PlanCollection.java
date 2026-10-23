package io.pockethive.planner.commands;

import io.pockethive.planner.domain.InvalidWorkspace;
import java.util.Arrays;
import java.util.Set;

/**
 * Responsibility: name supported collections and their editable command fields.
 * Must not: validate workspace references or duplicate lifecycle policy.
 * Contract: docs/ARCHITECTURE.md scoped commands and data contract.
 */
public enum PlanCollection {
    STREAMS("streams", Set.of("name", "description", "dependsOn")),
    ACTIVITY_TYPES("activityTypes", Set.of("name", "color")),
    ACTIVITIES("activities", Set.of("name", "streamId", "typeId", "start", "durationDays", "includeWeekends",
            "progress", "status", "issueIds", "dependsOn", "jiraUrl", "started", "done", "startedAt", "completedAt")),
    ISSUES("issues", Set.of("title", "description", "scope", "streamIds", "activityIds", "blocker",
            "discovered", "open", "descriptionIncomplete", "jiraUrl"));

    private final String field;
    private final Set<String> editable;

    PlanCollection(String field, Set<String> editable) {
        this.field = field;
        this.editable = editable;
    }

    public String field() {
        return field;
    }

    public Set<String> editable() {
        return editable;
    }

    public static PlanCollection from(String field) {
        return Arrays.stream(values()).filter(collection -> collection.field.equals(field)).findFirst()
                .orElseThrow(() -> new InvalidWorkspace("Unknown plan collection"));
    }
}
