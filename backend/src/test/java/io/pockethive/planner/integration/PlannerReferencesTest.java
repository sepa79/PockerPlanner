package io.pockethive.planner.integration;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.pockethive.planner.http.ApiFailure;
import java.nio.charset.StandardCharsets;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

class PlannerReferencesTest {
    @ParameterizedTest
    @MethodSource("pythonGoldenTags")
    void matchesPythonReferenceFullDigestGoldenVectors(String plan, String activity, String expected) {
        assertEquals(expected, PlannerReferences.tag("qa", plan, activity));
        assertEquals(55, expected.length());
    }

    static Stream<Arguments> pythonGoldenTags() {
        String controls = IntStream.range(0, 32).collect(StringBuilder::new,
            (builder, character) -> builder.append((char) character), StringBuilder::append).toString();
        return Stream.of(
            Arguments.of("contract-plan", "activity-alpha-minimal", "pp.activity:8SNVa7rPg60uMbyvj0nQKIgB6pjN-jwKGPzz8JQPEdw"),
            Arguments.of("x".repeat(80), "ą".repeat(80), "pp.activity:v9-WHRBIMGyKJSKslPoCCoujWaJ6ZDrd6d4FME4vlNc"),
            Arguments.of("Zażółć 🐝", "東京/雪\\\"", "pp.activity:uy5OnlNhg3M9DLsEmd_4BbYy22AJng2PqOx0KN3FJLw"),
            Arguments.of("astral😀𐀀" + new String(Character.toChars(0x10ffff)), "🚀", "pp.activity:kWoYr1ozQlLpWKE8ygaYVNHq2C_zCfDgSlc2Yx8xQOY"),
            Arguments.of("plan\\path", "activity\"quoted\\", "pp.activity:SzlHSS8VzwvCQrbXttymcN8URBwjdNCjqjeiCkfbqfk"),
            Arguments.of("control" + controls, "next\n\r\t\b\f" + (char) 11 + (char) 31, "pp.activity:di4y8lR6B4L5rxPYmEqmicaBfHoRZ21hxTMXB7lmros"),
            Arguments.of("a:b:c", "d/e?f#%20 +", "pp.activity:Lv9Zz8LPxoWxIMMM2BfMcEf3pGBSOf2KKCVUb4n4g6Y"),
            Arguments.of("é", "e\u0301", "pp.activity:S2X0qj_41MuH0IVM4CnIQBz2jQu1oJiUgbL8gTTk6zE"),
            Arguments.of("\u2028\u2029" + (char) 127, "/</script>", "pp.activity:Y9Q8PwCp-8FlntrZljYtsCDITQcmBnXSrYDywpPpkjk"),
            Arguments.of("ab", "c", "pp.activity:8O4VI7q-HkmcsBMBESI_rtwpRCFrj-WCujcvDGCOuXQ"),
            Arguments.of("a", "bc", "pp.activity:EmB5LhUTeB5jtI0ihV9cqvr1amEfJGT2MWtz4xBWuDg"));
    }

    @Test
    void matchesExactPythonBytesWithLowercaseEscapesAndUnescapedAstralUnicode() {
        String expected = "[\"qa\",\"a\\u000b\\u001f\\n\\t\\b\\f\\r\\\"\\\\\",\"ą🐝𐀀\"]";
        assertArrayEquals(expected.getBytes(StandardCharsets.UTF_8),
            PhJson.identity("qa", "a" + (char) 11 + (char) 31 + "\n\t\b\f\r\"\\", "ą🐝𐀀"));
    }

    @Test
    void instancePlanAndEveryActivityCharacterRemainPartOfIdentity() {
        String tag = PlannerReferences.tag("qa", "x".repeat(80), "ą".repeat(80));
        assertNotEquals(tag, PlannerReferences.tag("qb", "x".repeat(80), "ą".repeat(80)));
        assertNotEquals(tag, PlannerReferences.tag("qa", "x".repeat(79) + "y", "ą".repeat(80)));
        assertNotEquals(tag, PlannerReferences.tag("qa", "x".repeat(80), "ą".repeat(79) + "b"));
        assertNotEquals(PlannerReferences.tag("qa", "é", "id"), PlannerReferences.tag("qa", "e\u0301", "id"));
        assertEquals("pp:qa:literal:plan/ą🐝", PlannerReferences.testPlan("qa", "literal:plan/ą🐝"));
    }

    @Test
    void instanceIsExplicitAsciiAndInvalidUnicodeNeverGetsReplaced() {
        for (String value : new String[]{"", " ", "bad:instance", "x".repeat(41), "ą", "qa\n"}) {
            assertEquals(503, assertThrows(ApiFailure.class, () -> PlannerReferences.instance(value)).status());
        }
        assertEquals("A_z-9", PlannerReferences.instance("A_z-9"));
        assertEquals("x".repeat(40), PlannerReferences.instance("x".repeat(40)));
        assertThrows(ApiFailure.class, () -> PlannerReferences.tag("qa", "plan", "\ud800"));
        assertThrows(ApiFailure.class, () -> PlannerReferences.tag("qa", "\udc00", "activity"));
    }
}
