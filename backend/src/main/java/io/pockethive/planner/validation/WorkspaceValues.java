package io.pockethive.planner.validation;

import com.fasterxml.jackson.databind.JsonNode;
import io.pockethive.planner.domain.InvalidWorkspace;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Responsibility: validate workspace scalar values and parse their comparison values.
 * Must not: normalize JSON, configure serialization, read a clock or compose lifecycle changes.
 * Contract: docs/ARCHITECTURE.md data contract and activity execution timing.
 */
public final class WorkspaceValues {
    private static final Pattern DATE = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}");
    private static final Pattern TIMESTAMP = Pattern.compile(
            "([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,6})?)"
                    + "(Z|([+-])([01][0-9]|2[0-3]):([0-5][0-9]))");

    private WorkspaceValues() {}

    public static String text(JsonNode value, String field, int maximum, boolean required) {
        if (value == null || !value.isTextual()) {
            throw new InvalidWorkspace("Invalid " + field);
        }
        String original = value.textValue();
        String stripped = strip(original);
        if (original.codePointCount(0, original.length()) > maximum || (required && stripped.isEmpty())) {
            throw new InvalidWorkspace("Invalid " + field);
        }
        return stripped;
    }

    public static LocalDate calendarDate(JsonNode value, String field) {
        if (value == null || !value.isTextual() || !DATE.matcher(value.textValue()).matches()) {
            throw new InvalidWorkspace(field + " must be a valid YYYY-MM-DD calendar date");
        }
        try {
            LocalDate parsed = LocalDate.parse(value.textValue());
            if (parsed.getYear() == 0) {
                throw new DateTimeException("Invalid year");
            }
            return parsed;
        } catch (DateTimeException exception) {
            throw new InvalidWorkspace(field + " must be a valid YYYY-MM-DD calendar date");
        }
    }

    public static Instant timestamp(JsonNode value, String field) {
        if (value == null || !value.isTextual()) {
            throw new InvalidWorkspace(field + " must be an ISO timestamp with a timezone");
        }
        Matcher matched = TIMESTAMP.matcher(value.textValue());
        if (!matched.matches()) {
            throw new InvalidWorkspace(field + " must be an ISO timestamp with a timezone");
        }
        try {
            LocalDateTime local = LocalDateTime.parse(matched.group(1));
            if (local.getYear() == 0) {
                throw new DateTimeException("Invalid year");
            }
            int offsetSeconds = 0;
            if (!matched.group(2).equals("Z")) {
                offsetSeconds = Integer.parseInt(matched.group(4)) * 3600
                        + Integer.parseInt(matched.group(5)) * 60;
                if (matched.group(3).equals("-")) {
                    offsetSeconds = -offsetSeconds;
                }
            }
            return local.toInstant(ZoneOffset.UTC).minusSeconds(offsetSeconds);
        } catch (DateTimeException exception) {
            throw new InvalidWorkspace(field + " must be an ISO timestamp with a timezone");
        }
    }

    public static int progress(JsonNode value) {
        if (value == null || !value.isIntegralNumber() || !value.canConvertToInt()
                || value.intValue() < 0 || value.intValue() > 100) {
            throw new InvalidWorkspace("Progress must be 0–100");
        }
        return value.intValue();
    }

    static void jiraUrl(JsonNode value, String field) {
        String link = text(value, field, 1000, false);
        if (link.isEmpty()) {
            return;
        }
        try {
            URI parsed = new URI(link);
            if (!"https".equalsIgnoreCase(parsed.getScheme()) || parsed.getHost() == null
                    || parsed.getRawUserInfo() != null || parsed.getPort() > 65535) {
                throw new InvalidWorkspace(field + " must be an HTTPS URL");
            }
        } catch (URISyntaxException exception) {
            throw new InvalidWorkspace(field + " must be an HTTPS URL");
        }
    }

    private static String strip(String value) {
        int start = 0;
        int end = value.length();
        while (start < end && whitespace(value.codePointAt(start))) {
            start += Character.charCount(value.codePointAt(start));
        }
        while (end > start && whitespace(value.codePointBefore(end))) {
            end -= Character.charCount(value.codePointBefore(end));
        }
        return value.substring(start, end);
    }

    private static boolean whitespace(int codePoint) {
        return Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint) || codePoint == 0x85;
    }
}
