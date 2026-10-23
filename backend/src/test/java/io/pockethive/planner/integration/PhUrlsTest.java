package io.pockethive.planner.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.pockethive.planner.http.ApiFailure;
import org.junit.jupiter.api.Test;

class PhUrlsTest {
    @Test
    void validatesConfiguredDestinationsWithoutTrimmingOrInferringSettings() {
        for (String value : new String[]{"", " ", "file:///etc/passwd", "//ph", "https://user:pass@ph",
                "https://user@ph", "https://ph?", "https://ph#", "https://ph:0", "https://ph:65536",
                "https://ph:", "https://ph:bad", " https://ph", "https://ph/\n", "https://"}) {
            ApiFailure failure = assertThrows(ApiFailure.class, () -> PhUrls.base(value, "POCKETHIVE_PUBLIC_URL"));
            assertEquals(503, failure.status());
        }
        assertEquals("https://ph.example/base", PhUrls.base("https://ph.example/base///", "POCKETHIVE_PUBLIC_URL"));
        assertEquals("http://127.0.0.1:8080", PhUrls.base("http://127.0.0.1:8080/", "POCKETHIVE_BASE_URL"));
        assertEquals("https://[::1]:443", PhUrls.base("https://[::1]:443", "POCKETHIVE_BASE_URL"));
    }

    @Test
    void encodesLiteralSegmentsWithoutFormEncodingOrDoubleDecoding() {
        assertEquals("swarm%2Fone%20%2B%3F%23%25%5C%22%C4%85%F0%9F%90%9D",
            PhUrls.segment("swarm/one +?#%\\\"ą🐝"));
        assertEquals("%252F", PhUrls.segment("%2F"));
        assertEquals("AZaz09-_.~", PhUrls.segment("AZaz09-_.~"));
    }
}
