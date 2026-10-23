package io.pockethive.planner.execution;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.WorkspaceJson;
import java.io.IOException;
import java.io.InputStream;

final class ExecutionTestDocuments {
    private ExecutionTestDocuments() {}

    static ObjectNode workspace() throws IOException {
        try (InputStream input = ExecutionTestDocuments.class.getResourceAsStream("/contracts/workspace.json")) {
            if (input == null) {
                throw new IllegalStateException("Missing synthetic workspace contract fixture");
            }
            return WorkspaceJson.parse(input.readAllBytes());
        }
    }

    static ObjectNode plan(ObjectNode document) {
        return (ObjectNode) document.path("plans").get(0);
    }

    static ObjectNode activity(ObjectNode document) {
        return (ObjectNode) plan(document).path("activities").get(0);
    }

    static ObjectNode issue(ObjectNode document) {
        return (ObjectNode) plan(document).path("issues").get(0);
    }
}
