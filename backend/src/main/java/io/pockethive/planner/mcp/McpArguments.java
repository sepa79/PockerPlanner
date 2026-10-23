package io.pockethive.planner.mcp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.spec.McpSchema;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import java.io.IOException;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;

/**
 * Responsibility: enforce tool-envelope fields and literal JSON argument types without coercion.
 * Must not: duplicate domain validation, normalize values or infer missing tool arguments.
 * Contract: docs/MCP.md strict strings/objects and integral expected_revision; domain owns meaning.
 */
final class McpArguments {
    private final ObjectNode values;

    McpArguments(McpSchema.Tool tool, Map<String, Object> arguments, McpJsonMapper mapper) {
        try {
            values = WorkspaceJson.parse(mapper.writeValueAsBytes(arguments == null ? Map.of() : arguments));
        } catch (IOException exception) {
            throw new InvalidWorkspace("Supply strict JSON tool arguments");
        }
        var schema = tool.inputSchema();
        for (Object field : (List<?>) schema.get("required")) {
            String required = (String) field;
            if (!values.has(required)) {
                throw new InvalidWorkspace("Missing tool argument: " + required);
            }
        }
        values.fieldNames().forEachRemaining(field -> {
            if (!((Map<?, ?>) schema.get("properties")).containsKey(field)) {
                throw new InvalidWorkspace("Unknown tool argument");
            }
        });
    }

    String text(String name) {
        if (!values.path(name).isTextual()) {
            throw new InvalidWorkspace(name + " must be a string");
        }
        return values.get(name).textValue();
    }

    ObjectNode object(String name) {
        if (!(values.get(name) instanceof ObjectNode object)) {
            throw new InvalidWorkspace(name + " must be an object");
        }
        return object;
    }

    BigInteger revision() {
        if (!values.path("expected_revision").isIntegralNumber()) {
            throw new InvalidWorkspace("expected_revision must be an integer");
        }
        return values.get("expected_revision").bigIntegerValue();
    }

    JsonNode deadline() {
        JsonNode value = values.get("deadline");
        if (value != null && !value.isNull() && !value.isTextual()) {
            throw new InvalidWorkspace("deadline must be a string or null");
        }
        return value;
    }
}
