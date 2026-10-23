package io.pockethive.planner.integration;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.WorkspaceJson;
import java.io.IOException;

final class IntegrationDocuments {
    private IntegrationDocuments() {}

    static ObjectNode workspace() throws IOException {
        try (var input = IntegrationDocuments.class.getResourceAsStream("/contracts/workspace.json")) {
            if (input == null) {
                throw new IllegalStateException("Missing synthetic workspace contract fixture");
            }
            return WorkspaceJson.parse(input.readAllBytes());
        }
    }
}
