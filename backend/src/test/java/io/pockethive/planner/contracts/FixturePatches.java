package io.pockethive.planner.contracts;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

final class FixturePatches {
    private FixturePatches() {}

    static ObjectNode apply(ObjectNode document, JsonNode operations) {
        ObjectNode result = document.deepCopy();
        for (JsonNode operation : operations) {
            String path = operation.get("path").textValue();
            if (!path.startsWith("/")) {
                throw new AssertionError("Fixture patch requires a non-root JSON pointer");
            }
            String[] tokens = path.substring(1).split("/", -1);
            JsonNode parent = result;
            for (int index = 0; index < tokens.length - 1; index++) {
                String key = unescape(tokens[index]);
                parent = parent.isArray() ? parent.get(Integer.parseInt(key)) : parent.get(key);
            }
            String key = unescape(tokens[tokens.length - 1]);
            String action = operation.get("op").textValue();
            if (parent instanceof ArrayNode array) {
                int position = key.equals("-") ? array.size() : Integer.parseInt(key);
                switch (action) {
                    case "add" -> array.insert(position, operation.get("value").deepCopy());
                    case "replace" -> array.set(position, operation.get("value").deepCopy());
                    case "remove" -> array.remove(position);
                    default -> throw new AssertionError("Unsupported fixture patch: " + action);
                }
            } else if (parent instanceof ObjectNode object) {
                if (!action.equals("add") && !object.has(key)) {
                    throw new AssertionError("Fixture patch must target an existing field");
                }
                switch (action) {
                    case "add", "replace" -> object.set(key, operation.get("value").deepCopy());
                    case "remove" -> object.remove(key);
                    default -> throw new AssertionError("Unsupported fixture patch: " + action);
                }
            } else {
                throw new AssertionError("Fixture patch requires a container parent");
            }
        }
        return result;
    }

    private static String unescape(String token) {
        return token.replace("~1", "/").replace("~0", "~");
    }
}
