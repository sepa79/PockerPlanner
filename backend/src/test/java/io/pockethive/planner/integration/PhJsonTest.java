package io.pockethive.planner.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.pockethive.planner.http.ApiFailure;
import java.nio.charset.StandardCharsets;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class PhJsonTest {
    @ParameterizedTest
    @MethodSource("invalidDocuments")
    void rejectsAmbiguousMalformedOrScalarJson(String document) {
        assertEquals(503, assertThrows(ApiFailure.class,
            () -> PhJson.parse(document.getBytes(StandardCharsets.UTF_8))).status());
    }

    static Stream<String> invalidDocuments() {
        return Stream.of("", "null", "true", "1", "\"array\"", "{}[]", "{} trailing", "[1,]", "{'x':1}",
            "{\"x\":1,\"x\":2}", "[{\"nested\":1,\"nested\":2}]", "{\"text\":\"\\ud800\"}",
            "{\"\\udc00\":1}", "{\"x\":NaN}", "{\"x\":Infinity}", "{\"x\":1e9999}",
            "[".repeat(65) + "0" + "]".repeat(65));
    }

    @Test
    void rejectsMalformedUtf8AndUtf16RatherThanRepairingOrGuessingEncoding() {
        assertThrows(ApiFailure.class, () -> PhJson.parse(new byte[]{'{', '"', 'x', '"', ':', '"', (byte) 0xc3, '"', '}'}));
        assertThrows(ApiFailure.class, () -> PhJson.parse("{}".getBytes(StandardCharsets.UTF_16LE)));
    }

    @Test
    void preservesTypesAndAllowsThePhLimitRatherThanTheWorkspaceLimit() {
        var document = PhJson.parse("{\"s\":\"1\",\"n\":1,\"b\":true,\"null\":null}".getBytes(StandardCharsets.UTF_8));
        assertEquals(true, document.get("s").isTextual());
        assertEquals(true, document.get("n").isIntegralNumber());
        assertEquals(true, document.get("b").isBoolean());
        String full = "[\"" + "ą".repeat((PhJson.MAX_BYTES - 4) / 2) + "\"]";
        assertEquals(PhJson.MAX_BYTES, full.getBytes(StandardCharsets.UTF_8).length);
        assertEquals(1, PhJson.parse(full.getBytes(StandardCharsets.UTF_8)).size());
        assertThrows(ApiFailure.class, () -> PhJson.parse((full + " ").getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void outboundDocumentsCannotSmuggleNonJsonOrInvalidUnicode() {
        assertThrows(ApiFailure.class, () -> PhJson.encode(PhJson.object().put("number", Double.NaN)));
        assertThrows(ApiFailure.class, () -> PhJson.encode(PhJson.object().put("text", "\ud800")));
        assertThrows(ApiFailure.class, () -> PhJson.encode(PhJson.object().putPOJO("x", new Object())));
    }
}
