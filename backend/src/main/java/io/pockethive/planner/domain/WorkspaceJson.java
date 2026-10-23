package io.pockethive.planner.domain;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamWriteConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/**
 * Responsibility: encode and decode bounded, lossless workspace JSON.
 * Must not: coerce domain values, normalize optional fields or access persistence.
 * Contract: docs/ARCHITECTURE.md literal identifiers and compact UTF-8 documents.
 */
public final class WorkspaceJson {
    private static final ObjectMapper MAPPER = new ObjectMapper(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .streamReadConstraints(StreamReadConstraints.builder()
                    .maxNestingDepth(64).maxStringLength(WorkspaceLimits.MAX_DOCUMENT_BYTES).build())
            .streamWriteConstraints(StreamWriteConstraints.builder().maxNestingDepth(64).build())
            .build()).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    private WorkspaceJson() {}

    public static ObjectNode object() {
        return MAPPER.createObjectNode();
    }

    public static ArrayNode array() {
        return MAPPER.createArrayNode();
    }

    public static ObjectNode parse(byte[] bytes) {
        if (bytes == null || bytes.length > WorkspaceLimits.MAX_DOCUMENT_BYTES) {
            throw new InvalidWorkspace("Workspace must not exceed 1 MiB of UTF-8 JSON");
        }
        try {
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            JsonNode parsed = MAPPER.readTree(text);
            if (!(parsed instanceof ObjectNode document)) {
                throw new InvalidWorkspace("Workspace must be a JSON object");
            }
            validJson(document, 0);
            return document;
        } catch (CharacterCodingException exception) {
            throw new InvalidWorkspace("Workspace must contain valid UTF-8 JSON");
        } catch (IOException exception) {
            throw new InvalidWorkspace("Workspace must contain one valid JSON object");
        }
    }

    public static byte[] encode(JsonNode document) {
        validJson(document, 0);
        try {
            byte[] bytes = MAPPER.writeValueAsBytes(document);
            if (bytes.length > WorkspaceLimits.MAX_DOCUMENT_BYTES) {
                throw new InvalidWorkspace("Workspace must not exceed 1 MiB of compact UTF-8 JSON");
            }
            return bytes;
        } catch (JsonProcessingException exception) {
            throw new InvalidWorkspace("Workspace must contain valid UTF-8 JSON");
        }
    }

    private static void validJson(JsonNode node, int depth) {
        if (node == null || depth > 64 || node.isMissingNode() || node.isPojo() || node.isBinary()) {
            throw new InvalidWorkspace("Invalid workspace JSON value");
        }
        if (node.isFloatingPointNumber() && !Double.isFinite(node.doubleValue())) {
            throw new InvalidWorkspace("Workspace cannot contain non-finite numbers");
        }
        if (node.isTextual()) {
            validUnicode(node.textValue());
        }
        if (node.isObject()) {
            node.fieldNames().forEachRemaining(WorkspaceJson::validUnicode);
        }
        for (JsonNode child : node) {
            validJson(child, depth + 1);
        }
    }

    private static void validUnicode(String value) {
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (Character.isHighSurrogate(character)) {
                if (++index == value.length() || !Character.isLowSurrogate(value.charAt(index))) {
                    throw new InvalidWorkspace("Workspace must contain valid Unicode");
                }
            } else if (Character.isLowSurrogate(character)) {
                throw new InvalidWorkspace("Workspace must contain valid Unicode");
            }
        }
    }
}
