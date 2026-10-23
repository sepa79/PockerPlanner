package io.pockethive.planner.mcp;

import io.modelcontextprotocol.spec.McpSchema;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Responsibility: declare the seven supported tools, input schemas and safety annotations.
 * Must not: execute commands, expose replacement/deletion/PH controls or grant permissions.
 * Contract: docs/MCP.md tool names, descriptions and argument shapes.
 */
final class McpToolCatalog {
    private static final Map<String, Object> STRING = Map.of("type", "string");
    private static final Map<String, Object> OBJECT = Map.of("type", "object", "additionalProperties", true);
    private static final Map<String, Object> REVISION = Map.of("type", "integer");
    private static final Map<String, Object> COLLECTION = Map.of("type", "string", "enum",
        List.of("streams", "activityTypes", "activities", "issues"));

    private McpToolCatalog() {}

    static List<McpSchema.Tool> tools() {
        return List.of(
            tool("get_access", "Check this request's PocketHive identity and editing permission. Tokens are HTTP headers, never tool arguments.", true, false, Map.of(), List.of()),
            tool("list_plans", "List stable plan IDs, names, descriptions and the current workspace revision.", true, false, Map.of(), List.of()),
            tool("get_plan", "Read one complete plan, including streams, activity types, activities, issues and current revision.", true, false,
                Map.of("plan_id", STRING), List.of("plan_id")),
            tool("create_plan", "Create an empty plan with an explicit stable ID. Requires a verified PocketHive local-admin bearer token.", false, false,
                Map.of("plan_id", STRING, "name", STRING, "description", STRING, "expected_revision", REVISION,
                    "deadline", Map.of("anyOf", List.of(STRING, Map.of("type", "null")), "default", nullValue())),
                List.of("plan_id", "name", "description", "expected_revision")),
            tool("update_plan", "Patch a plan's name, description or optional deadline. Collections and IDs remain untouched. Requires local-admin.", false, true,
                Map.of("plan_id", STRING, "changes", OBJECT, "expected_revision", REVISION),
                List.of("plan_id", "changes", "expected_revision")),
            tool("create_plan_item", "Add a complete stream, activity type, activity or issue with an explicit ID. Existing IDs are rejected. Requires local-admin; canonical workspace validation applies.", false, false,
                Map.of("plan_id", STRING, "collection", COLLECTION, "item", OBJECT, "expected_revision", REVISION),
                List.of("plan_id", "collection", "item", "expected_revision")),
            tool("update_plan_item", "Patch selected fields of one existing item. Streams and activities accept dependsOn (predecessor ID or null); activity dependencies stay within their stream and calendar starts follow predecessors. Duration is full planned weekdays unless includeWeekends=true. Activity issueIds sets its actual issue assignments, narrowing broad issue scopes when unlinked. Issues accept ALL/STREAMS/ACTIVITIES scope with streamIds/activityIds; open=false closes and the store owns resolvedAt. IDs and resolution timestamps are not editable. Requires local-admin.", false, true,
                Map.of("plan_id", STRING, "collection", COLLECTION, "item_id", STRING, "changes", OBJECT, "expected_revision", REVISION),
                List.of("plan_id", "collection", "item_id", "changes", "expected_revision")));
    }

    private static Object nullValue() {
        return com.fasterxml.jackson.databind.node.NullNode.instance;
    }

    private static McpSchema.Tool tool(String name, String description, boolean readOnly, boolean destructive,
                                        Map<String, Object> properties, List<String> required) {
        return McpSchema.Tool.builder().name(name).description(description)
            .inputSchema(new McpSchema.JsonSchema("object", new LinkedHashMap<>(properties), required, false, null, null))
            .outputSchema(OBJECT)
            .annotations(new McpSchema.ToolAnnotations(null, readOnly, destructive, readOnly, false, null)).build();
    }
}
