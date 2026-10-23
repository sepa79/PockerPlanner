package io.pockethive.planner.validation;

import com.fasterxml.jackson.databind.JsonNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Responsibility: validate literal plan-local predecessor references and dependency graphs.
 * Must not: schedule activities, rewrite starts or access another plan's references.
 * Contract: docs/ARCHITECTURE.md data contract; dependencies are acyclic finish-to-start references.
 */
final class WorkspaceDependencies {
    private WorkspaceDependencies() {}

    static void validate(Map<String, JsonNode> items, String label, boolean sameStream) {
        for (Map.Entry<String, JsonNode> entry : items.entrySet()) {
            JsonNode predecessor = entry.getValue().get("dependsOn");
            if (predecessor == null || predecessor.isNull()) {
                continue;
            }
            if (!predecessor.isTextual() || !items.containsKey(predecessor.textValue())
                    || predecessor.textValue().equals(entry.getKey())) {
                throw new InvalidWorkspace("Invalid " + label + " dependency");
            }
            if (sameStream && !entry.getValue().get("streamId")
                    .equals(items.get(predecessor.textValue()).get("streamId"))) {
                throw new InvalidWorkspace("Activity dependencies must stay within the same stream");
            }
        }
        Set<String> resolved = new HashSet<>();
        for (String itemId : items.keySet()) {
            Set<String> chain = new HashSet<>();
            String current = itemId;
            while (current != null && !resolved.contains(current)) {
                if (!chain.add(current)) {
                    throw new InvalidWorkspace("Cyclic " + label + " dependency");
                }
                JsonNode predecessor = items.get(current).get("dependsOn");
                current = predecessor == null || predecessor.isNull() ? null : predecessor.textValue();
            }
            resolved.addAll(chain);
        }
    }
}
