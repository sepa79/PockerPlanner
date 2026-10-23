package io.pockethive.planner.mcp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.spec.McpSchema;
import io.pockethive.planner.auth.PhAuthClients;
import io.pockethive.planner.auth.PlannerAccess;
import io.pockethive.planner.commands.WorkspaceCommands;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.persistence.WorkspaceUnavailable;
import java.math.BigInteger;
import java.sql.SQLException;
import java.util.Map;
import org.junit.jupiter.api.Test;

class McpToolsTest {
    @Test
    void projectsCommandSnapshotWithoutRereadingAnyPotentiallyNewerRevision() {
        var commands = mock(WorkspaceCommands.class);
        var access = mock(PlannerAccess.class);
        var saved = WorkspaceJson.object().put("schemaVersion", 1).put("revision", 8);
        saved.putArray("plans").add(WorkspaceJson.object().put("id", "other"))
            .add(WorkspaceJson.object().put("id", "chosen").put("name", "snapshot eight"));
        when(commands.updatePlan(eq("chosen"), any(), eq(BigInteger.valueOf(7)))).thenReturn(saved);
        var result = call(new McpTools(commands, access, McpConfiguration.protocolMapper()), "update_plan",
            McpTransportContext.create(Map.of(McpConfiguration.AUTHORIZATION, McpIdentityFixture.ADMIN)),
            Map.of("plan_id", "chosen", "changes", Map.of("name", "snapshot eight"), "expected_revision", 7));
        assertFalse(result.isError());
        var content = WorkspaceJson.parse(text(result).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertEquals(2, content.size());
        assertEquals(8, content.get("revision").intValue());
        assertEquals("chosen", content.at("/plan/id").textValue());
        verify(commands).updatePlan(eq("chosen"), any(), eq(BigInteger.valueOf(7)));
        verify(access).requireEditor(McpIdentityFixture.ADMIN);
        verifyNoMoreInteractions(commands, access);
    }

    @Test
    void unconfiguredAuthAndWorkspaceFailureAreTypedAndSafe() {
        var commands = mock(WorkspaceCommands.class);
        var tools = new McpTools(commands, new PlannerAccess(new PhAuthClients("", false)), McpConfiguration.protocolMapper());
        var anonymous = call(tools, "get_access", McpTransportContext.EMPTY, Map.of());
        assertFalse(anonymous.isError());
        assertTrue(text(anonymous).contains("\"configured\":false"));
        var denied = call(tools, "update_plan", McpTransportContext.create(Map.of(McpConfiguration.AUTHORIZATION, McpIdentityFixture.ADMIN)),
            Map.of("plan_id", "chosen", "changes", Map.of("name", "test"), "expected_revision", 0));
        assertTrue(denied.isError());
        assertTrue(text(denied).startsWith("AUTH_503:"));
        when(commands.listPlans()).thenThrow(new WorkspaceUnavailable(new SQLException("/private/path token secret")));
        var failed = call(tools, "list_plans", McpTransportContext.EMPTY, Map.of());
        assertTrue(failed.isError());
        assertEquals("WORKSPACE_UNAVAILABLE: Planner workspace is unavailable.", text(failed));
    }

    private static McpSchema.CallToolResult call(McpTools tools, String name, McpTransportContext context, Map<String, Object> arguments) {
        var specification = tools.specifications().stream().filter(candidate -> candidate.tool().name().equals(name)).findFirst().orElseThrow();
        return specification.callHandler().apply(context, new McpSchema.CallToolRequest(name, arguments));
    }

    static String text(McpSchema.CallToolResult result) {
        return ((McpSchema.TextContent) result.content().getFirst()).text();
    }
}
