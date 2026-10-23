package io.pockethive.planner.integration;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.core.StreamWriteConstraints;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.http.ApiFailure;
import java.io.IOException;
import java.io.StringWriter;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/**
 * Responsibility: bound and strictly decode PH JSON and encode Python-compatible identities.
 * Must not: use the one-MiB workspace codec, coerce schemas or repair invalid Unicode.
 * Contract: docs/POCKETHIVE_INTEGRATION.md eight-MiB responses and compact UTF-8 tag input.
 */
final class PhJson {
    static final int MAX_BYTES = 8 * 1024 * 1024;
    private static final ObjectMapper MAPPER = JsonMapper.builder(JsonFactory.builder()
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
        .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(64)
            .maxStringLength(MAX_BYTES).maxDocumentLength(MAX_BYTES).build())
        .streamWriteConstraints(StreamWriteConstraints.builder().maxNestingDepth(64).build())
        .build()).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

    private PhJson() {}

    static ObjectNode object() {
        return MAPPER.createObjectNode();
    }

    static JsonNode parse(byte[] bytes) {
        if (bytes.length > MAX_BYTES) {
            throw invalid();
        }
        try {
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            JsonNode document = MAPPER.readTree(text);
            if (document == null || !document.isContainerNode()) {
                throw invalid();
            }
            valid(document, 0);
            return document;
        } catch (IOException exception) {
            throw invalid();
        }
    }

    static byte[] encode(JsonNode document) {
        valid(document, 0);
        try {
            byte[] bytes = MAPPER.writeValueAsBytes(document);
            if (bytes.length > MAX_BYTES) {
                throw invalid();
            }
            return bytes;
        } catch (IOException exception) {
            throw invalid();
        }
    }

    static byte[] identity(String instance, String plan, String activity) {
        unicode(instance);
        unicode(plan);
        unicode(activity);
        try {
            StringWriter output = new StringWriter();
            try (JsonGenerator generator = MAPPER.createGenerator(output)) {
                generator.setHighestNonEscapedChar(0);
                generator.setCharacterEscapes(new PythonEscapes());
                generator.writeStartArray();
                generator.writeString(instance);
                generator.writeString(plan);
                generator.writeString(activity);
                generator.writeEndArray();
            }
            return output.toString().getBytes(StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw invalid();
        }
    }

    private static void valid(JsonNode node, int depth) {
        if (node == null || depth > 64 || node.isMissingNode() || node.isPojo() || node.isBinary()
                || node.isFloatingPointNumber() && !Double.isFinite(node.doubleValue())) {
            throw invalid();
        }
        if (node.isTextual()) {
            unicode(node.textValue());
        }
        if (node.isObject()) {
            node.fieldNames().forEachRemaining(PhJson::unicode);
        }
        for (JsonNode child : node) {
            valid(child, depth + 1);
        }
    }

    static void unicode(String value) {
        if (value == null) {
            throw invalid();
        }
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (Character.isHighSurrogate(character)) {
                if (++index == value.length() || !Character.isLowSurrogate(value.charAt(index))) {
                    throw invalid();
                }
            } else if (Character.isLowSurrogate(character)) {
                throw invalid();
            }
        }
    }

    static ApiFailure invalid() {
        return new ApiFailure(503, "PocketHive returned unavailable or invalid data; no automatic retry.");
    }
}
