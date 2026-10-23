package io.pockethive.planner.validation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.WorkspaceJson;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

final class ValidationFixtures {
    private ValidationFixtures() {}

    static ObjectNode workspace() {
        try (InputStream resource = ValidationFixtures.class.getResourceAsStream("/contracts/workspace.json")) {
            if (resource == null) {
                throw new IllegalStateException("Missing synthetic workspace contract fixture");
            }
            return WorkspaceJson.parse(resource.readAllBytes());
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    static ObjectNode plan(ObjectNode document) {
        return (ObjectNode) document.at("/plans/0");
    }

    static ObjectNode activity(ObjectNode document) {
        return (ObjectNode) document.at("/plans/0/activities/0");
    }

    static ObjectNode issue(ObjectNode document) {
        return (ObjectNode) document.at("/plans/0/issues/0");
    }

    static JsonNode value(String json) {
        return WorkspaceJson.parse(("{\"value\":" + json + "}").getBytes(StandardCharsets.UTF_8)).get("value");
    }

    static void set(ObjectNode document, String pointer, JsonNode value) {
        int separator = pointer.lastIndexOf('/');
        ObjectNode parent = (ObjectNode) document.at(pointer.substring(0, separator));
        parent.set(pointer.substring(separator + 1), value);
    }

    static void remove(ObjectNode document, String pointer) {
        int separator = pointer.lastIndexOf('/');
        ObjectNode parent = (ObjectNode) document.at(pointer.substring(0, separator));
        parent.remove(pointer.substring(separator + 1));
    }
}
