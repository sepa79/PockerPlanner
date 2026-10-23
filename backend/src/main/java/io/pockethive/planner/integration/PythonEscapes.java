package io.pockethive.planner.integration;

import com.fasterxml.jackson.core.SerializableString;
import com.fasterxml.jackson.core.io.CharacterEscapes;
import com.fasterxml.jackson.core.io.SerializedString;

/**
 * Responsibility: match Python JSON lowercase control-character escapes for tag hashing.
 * Must not: escape non-ASCII characters or alter any identity character.
 * Contract: json.dumps(ensure_ascii=False, separators=(",", ":")) byte parity.
 */
final class PythonEscapes extends CharacterEscapes {
    private final int[] escapes = CharacterEscapes.standardAsciiEscapesForJSON();

    PythonEscapes() {
        for (int character = 0; character < 32; character++) {
            if (escapes[character] == CharacterEscapes.ESCAPE_STANDARD) {
                escapes[character] = CharacterEscapes.ESCAPE_CUSTOM;
            }
        }
    }

    @Override
    public int[] getEscapeCodesForAscii() {
        return escapes;
    }

    @Override
    public SerializableString getEscapeSequence(int character) {
        return character < 32
            ? new SerializedString("\\u00" + "0123456789abcdef".charAt(character >>> 4)
                + "0123456789abcdef".charAt(character & 15)) : null;
    }
}
