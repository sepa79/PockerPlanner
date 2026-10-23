package io.pockethive.planner.integration;

import io.pockethive.planner.http.ApiFailure;
import java.net.URI;
import java.nio.charset.StandardCharsets;

/**
 * Responsibility: validate fixed PH destinations and encode literal run identities.
 * Must not: infer destinations from requests or include credentials in links.
 * Contract: docs/POCKETHIVE_INTEGRATION.md operator-owned ingress and exact journal links.
 */
public final class PhUrls {
    private PhUrls() {}

    static String base(String value, String setting) {
        try {
            URI uri = URI.create(value);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                    || uri.getHost() == null || uri.getRawUserInfo() != null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || uri.getPort() < -1 || uri.getPort() > 65535 || uri.getPort() == 0
                    || uri.getRawAuthority().endsWith(":")) {
                throw new IllegalArgumentException();
            }
            return value.replaceAll("/+$", "");
        } catch (IllegalArgumentException | NullPointerException exception) {
            throw new ApiFailure(503, "Configure " + setting + " as an HTTP(S) base URL without credentials, query or fragment.");
        }
    }

    public static String segment(String value) {
        PhJson.unicode(value);
        StringBuilder encoded = new StringBuilder();
        for (byte octet : value.getBytes(StandardCharsets.UTF_8)) {
            int unsigned = Byte.toUnsignedInt(octet);
            if (unsigned >= 'a' && unsigned <= 'z' || unsigned >= 'A' && unsigned <= 'Z'
                    || unsigned >= '0' && unsigned <= '9' || unsigned == '-' || unsigned == '_'
                    || unsigned == '.' || unsigned == '~') {
                encoded.append((char) unsigned);
            } else {
                encoded.append('%').append("0123456789ABCDEF".charAt(unsigned >>> 4))
                    .append("0123456789ABCDEF".charAt(unsigned & 15));
            }
        }
        return encoded.toString();
    }

    static URI ingress(String base, String path) {
        try {
            URI relative = URI.create(path);
            if (!path.startsWith("/orchestrator/api/") || relative.isAbsolute()
                    || relative.getRawAuthority() != null || relative.getRawFragment() != null
                    || !relative.normalize().equals(relative) || path.indexOf('\\') >= 0) {
                throw new IllegalArgumentException();
            }
            return URI.create(base + path);
        } catch (IllegalArgumentException | NullPointerException exception) {
            throw new ApiFailure(503, "Unsupported PocketHive ingress path.");
        }
    }
}
