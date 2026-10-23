package io.pockethive.planner.mcp;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.server.McpStatelessServerFeatures;
import io.modelcontextprotocol.spec.McpSchema;
import io.pockethive.planner.auth.PlannerAccess;
import io.pockethive.planner.auth.SessionAccess;
import io.pockethive.planner.commands.PlanCollection;
import io.pockethive.planner.commands.WorkspaceCommands;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.RevisionConflict;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.http.ApiFailure;
import io.pockethive.planner.persistence.WorkspaceUnavailable;
import java.io.IOException;
import java.util.List;

/**
 * Responsibility: adapt official SDK calls to shared commands, fresh access and typed safe tool errors.
 * Must not: save independently, retain caller identity or reread after a successful mutation.
 * Contract: docs/MCP.md isError failures and canonical {revision, plan} mutation results.
 */
final class McpTools {
    private final WorkspaceCommands commands;
    private final PlannerAccess access;
    private final McpJsonMapper mapper;

    McpTools(WorkspaceCommands commands, PlannerAccess access, McpJsonMapper mapper) {
        this.commands = commands;
        this.access = access;
        this.mapper = mapper;
    }

    List<McpStatelessServerFeatures.SyncToolSpecification> specifications() {
        return McpToolCatalog.tools().stream().map(tool -> new McpStatelessServerFeatures.SyncToolSpecification(tool,
            (context, request) -> call(tool, context, request))).toList();
    }

    private McpSchema.CallToolResult call(McpSchema.Tool tool, McpTransportContext context, McpSchema.CallToolRequest request) {
        try {
            String authorization = (String) context.get(McpConfiguration.AUTHORIZATION);
            if (!tool.annotations().readOnlyHint()) {
                access.requireEditor(authorization);
            }
            McpArguments arguments = new McpArguments(tool, request.arguments(), mapper);
            ObjectNode result = switch (tool.name()) {
                case "get_access" -> session(access.access(authorization));
                case "list_plans" -> commands.listPlans();
                case "get_plan" -> commands.getPlan(arguments.text("plan_id"));
                case "create_plan" -> saved(commands.createPlan(arguments.text("plan_id"), arguments.text("name"),
                    arguments.text("description"), arguments.revision(), arguments.deadline()), arguments.text("plan_id"));
                case "update_plan" -> saved(commands.updatePlan(arguments.text("plan_id"), arguments.object("changes"),
                    arguments.revision()), arguments.text("plan_id"));
                case "create_plan_item" -> saved(commands.createItem(arguments.text("plan_id"),
                    PlanCollection.from(arguments.text("collection")), arguments.object("item"), arguments.revision()), arguments.text("plan_id"));
                case "update_plan_item" -> saved(commands.updateItem(arguments.text("plan_id"),
                    PlanCollection.from(arguments.text("collection")), arguments.text("item_id"), arguments.object("changes"),
                    arguments.revision()), arguments.text("plan_id"));
                default -> throw new IllegalStateException("Unregistered Planner tool");
            };
            return McpSchema.CallToolResult.builder().isError(false).structuredContent(result)
                .addTextContent(mapper.writeValueAsString(result)).build();
        } catch (ApiFailure failure) {
            return error("AUTH_" + failure.status(), failure.getMessage());
        } catch (RevisionConflict failure) {
            return error("REVISION_CONFLICT", failure.getMessage());
        } catch (InvalidWorkspace failure) {
            return error("INVALID_INPUT", failure.getMessage());
        } catch (WorkspaceUnavailable failure) {
            return error("WORKSPACE_UNAVAILABLE", "Planner workspace is unavailable.");
        } catch (IOException | RuntimeException failure) {
            return error("INTERNAL_ERROR", "Planner tool could not be completed.");
        }
    }

    private static ObjectNode session(SessionAccess access) {
        ObjectNode result = WorkspaceJson.object().put("canEdit", access.canEdit()).put("configured", access.configured());
        if (access.user() == null) {
            result.putNull("user");
        } else {
            result.set("user", WorkspaceJson.object().put("username", access.user().username())
                .put("displayName", access.user().displayName()));
        }
        return result;
    }

    private static ObjectNode saved(ObjectNode workspace, String planId) {
        for (var plan : workspace.withArray("plans")) {
            if (plan.path("id").textValue().equals(planId)) {
                ObjectNode result = WorkspaceJson.object();
                result.set("revision", workspace.get("revision"));
                result.set("plan", plan);
                return result;
            }
        }
        throw new IllegalStateException("Saved plan is missing from command result");
    }

    private static McpSchema.CallToolResult error(String code, String message) {
        return McpSchema.CallToolResult.builder().isError(true).addTextContent(code + ": " + message).build();
    }
}
