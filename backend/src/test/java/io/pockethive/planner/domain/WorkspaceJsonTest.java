package io.pockethive.planner.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.charset.StandardCharsets;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class WorkspaceJsonTest {
    @ParameterizedTest
    @MethodSource("malformed")
    void rejectsMalformedOrAmbiguousJson(String text) {
        assertThrows(InvalidWorkspace.class, () -> WorkspaceJson.parse(text.getBytes(StandardCharsets.UTF_8)));
    }

    static Stream<String> malformed() {
        return Stream.of("{}{}", "{\"id\":1,\"id\":2}", "[]", "null", "{\"text\":\"\\ud800\"}",
                "{\"x\":NaN}", "{\"x\":" + "[".repeat(65) + "0" + "]".repeat(65) + "}");
    }

    @Test
    void rejectsMalformedUtf8RatherThanReplacingIt() {
        assertThrows(InvalidWorkspace.class, () -> WorkspaceJson.parse(new byte[]{123, 34, 120, 34, 58, 34, (byte) 0xc3, 34, 125}));
        assertThrows(InvalidWorkspace.class, () -> WorkspaceJson.parse("{}".getBytes(StandardCharsets.UTF_16LE)));
    }

    @Test
    void preservesUnicodeAndExplicitNullWithoutAddingAbsentFields() {
        var document = WorkspaceJson.parse("{\"name\":\"Zażółć 🐝\",\"deadline\":null}".getBytes(StandardCharsets.UTF_8));
        assertEquals(document, WorkspaceJson.parse(WorkspaceJson.encode(document)));
        assertEquals(2, document.size());
    }

    @Test
    void refusesNonJsonValuesAndCountsUtf8BytesRatherThanCharacters() {
        assertThrows(InvalidWorkspace.class, () -> WorkspaceJson.encode(WorkspaceJson.object().put("number", Double.NaN)));
        assertThrows(InvalidWorkspace.class, () -> WorkspaceJson.encode(WorkspaceJson.object().put("text", "ą".repeat(600000))));
    }
}
