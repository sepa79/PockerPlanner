package io.pockethive.planner.commands;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.ActivityKey;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.RevisionConflict;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.execution.IssueAssignments;
import io.pockethive.planner.persistence.WorkspaceStore;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.math.BigInteger;
import java.util.Map;
import java.util.Set;

/**
 * Responsibility: compose scoped plan/item edits for every future transport.
 * Must not: persist independently, authorize users or implement calendar calculations.
 * Contract: docs/ARCHITECTURE.md commands delegate validation and atomic saves to their owners.
 */
public final class WorkspaceCommands {
    private static final Set<String> ACTIONS = Set.of("started", "done", "startedAt", "completedAt");
    private final WorkspaceStore store;
    private final WorkspaceValidator validator;

    public WorkspaceCommands(WorkspaceStore store, WorkspaceValidator validator) {
        this.store = store;
        this.validator = validator;
    }

    public ObjectNode listPlans() {
        ObjectNode current = store.read();
        ArrayNode plans = WorkspaceJson.array();
        for (JsonNode plan : current.withArray("plans")) {
            ObjectNode summary = WorkspaceJson.object();
            for (String field : Set.of("id", "name", "description")) {
                summary.set(field, plan.get(field).deepCopy());
            }
            plans.add(summary);
        }
        ObjectNode result = WorkspaceJson.object();
        result.set("revision", current.get("revision"));
        result.set("plans", plans);
        return result;
    }

    public ObjectNode getPlan(String planId) {
        ObjectNode current = store.read();
        ObjectNode result = WorkspaceJson.object();
        result.set("revision", current.get("revision"));
        result.set("plan", find(current.withArray("plans"), planId));
        return result;
    }

    public ObjectNode createPlan(String planId, String name, String description, BigInteger expectedRevision,
                                 JsonNode deadline) {
        ObjectNode current = current(expectedRevision);
        if (contains(current.withArray("plans"), planId)) {
            throw new InvalidWorkspace("Plan already exists: " + planId);
        }
        ObjectNode plan = WorkspaceJson.object().put("id", planId).put("name", name).put("description", description);
        for (PlanCollection collection : PlanCollection.values()) {
            plan.set(collection.field(), WorkspaceJson.array());
        }
        if (deadline != null && !deadline.isNull()) {
            plan.set("deadline", deadline.deepCopy());
        }
        current.withArray("plans").add(plan);
        return store.write(current);
    }

    public ObjectNode updatePlan(String planId, ObjectNode changes, BigInteger expectedRevision) {
        fields(changes, Set.of("name", "description", "deadline"), false);
        ObjectNode current = current(expectedRevision);
        find(current.withArray("plans"), planId).setAll(changes.deepCopy());
        return store.write(current);
    }

    public ObjectNode createItem(String planId, PlanCollection collection, ObjectNode item,
                                 BigInteger expectedRevision) {
        fields(item, collection.editable(), true);
        if (!item.path("id").isTextual() || item.path("id").textValue().isBlank()) {
            throw new InvalidWorkspace("Supply the new item ID");
        }
        ObjectNode current = current(expectedRevision);
        ObjectNode plan = find(current.withArray("plans"), planId);
        String itemId = item.get("id").textValue();
        if (contains(plan.withArray(collection.field()), itemId)) {
            throw new InvalidWorkspace("Item already exists: " + itemId);
        }
        ObjectNode created = item.deepCopy();
        ObjectNode actions = actions(collection, created);
        plan.withArray(collection.field()).add(created);
        if (collection == PlanCollection.ACTIVITIES) {
            validator.validate(current);
            IssueAssignments.assign(plan, created);
        }
        return store.write(current, Map.of(new ActivityKey(planId, itemId), actions));
    }

    public ObjectNode updateItem(String planId, PlanCollection collection, String itemId, ObjectNode changes,
                                 BigInteger expectedRevision) {
        fields(changes, collection.editable(), false);
        ObjectNode current = current(expectedRevision);
        ObjectNode plan = find(current.withArray("plans"), planId);
        ObjectNode item = find(plan.withArray(collection.field()), itemId);
        ObjectNode patch = changes.deepCopy();
        ObjectNode actions = actions(collection, patch);
        item.setAll(patch);
        if (collection == PlanCollection.ACTIVITIES) {
            if (item.path("progress").isIntegralNumber() && item.get("progress").intValue() < 100) {
                item.remove("completedAt");
            }
            if (changes.has("issueIds")) {
                validator.validate(current);
                IssueAssignments.assign(plan, item);
            }
        }
        return store.write(current, Map.of(new ActivityKey(planId, itemId), actions));
    }

    public ObjectNode saveActivity(ObjectNode request) {
        if (request == null || request.size() != 4 || !request.has("planId") || !request.has("activityId")
                || !request.has("item") || !request.has("expectedRevision") || !request.get("planId").isTextual()
                || !(request.get("item") instanceof ObjectNode item) || !item.path("id").isTextual()
                || !request.get("expectedRevision").isIntegralNumber()) {
            throw new InvalidWorkspace("Supply planId, activityId, item and expectedRevision");
        }
        String planId = request.get("planId").textValue();
        BigInteger revision = request.get("expectedRevision").bigIntegerValue();
        if (request.get("activityId").isNull()) {
            return createItem(planId, PlanCollection.ACTIVITIES, item, revision);
        }
        if (!request.get("activityId").isTextual() || !request.get("activityId").equals(item.get("id"))) {
            throw new InvalidWorkspace("The activity ID cannot change");
        }
        ObjectNode changes = item.deepCopy();
        String itemId = changes.remove("id").textValue();
        return updateItem(planId, PlanCollection.ACTIVITIES, itemId, changes, revision);
    }

    private ObjectNode current(BigInteger expectedRevision) {
        if (expectedRevision == null || expectedRevision.signum() < 0) {
            throw new InvalidWorkspace("Expected revision must be a nonnegative integer");
        }
        ObjectNode current = store.read();
        if (!current.get("revision").bigIntegerValue().equals(expectedRevision)) {
            throw new RevisionConflict();
        }
        return current;
    }

    private static ObjectNode find(ArrayNode items, String id) {
        for (JsonNode item : items) {
            if (item.get("id").asText().equals(id)) {
                return (ObjectNode) item;
            }
        }
        throw new InvalidWorkspace("Unknown item ID: " + id);
    }

    private static boolean contains(ArrayNode items, String id) {
        for (JsonNode item : items) {
            if (item.get("id").asText().equals(id)) {
                return true;
            }
        }
        return false;
    }

    private static void fields(ObjectNode changes, Set<String> editable, boolean includeId) {
        if (changes == null || changes.isEmpty()) {
            throw new InvalidWorkspace("Supply nonempty changes containing only editable fields");
        }
        changes.fieldNames().forEachRemaining(field -> {
            if (!editable.contains(field) && !(includeId && field.equals("id"))) {
                throw new InvalidWorkspace("Supply only editable fields");
            }
        });
    }

    private static ObjectNode actions(PlanCollection collection, ObjectNode item) {
        ObjectNode result = WorkspaceJson.object();
        if (collection == PlanCollection.ACTIVITIES) {
            for (String field : ACTIONS) {
                if (item.has(field)) {
                    result.set(field, item.remove(field));
                    if ((field.equals("started") || field.equals("done")) && !result.get(field).isBoolean()) {
                        throw new InvalidWorkspace("Started and Done actions must be booleans");
                    }
                }
            }
        }
        return result;
    }
}
