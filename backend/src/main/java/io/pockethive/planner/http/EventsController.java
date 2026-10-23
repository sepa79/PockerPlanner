package io.pockethive.planner.http;

import io.pockethive.planner.live.LiveUnavailable;
import io.pockethive.planner.live.RevisionStreams;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Responsibility: expose the public read-only live stream and its unbuffered response headers.
 * Must not: resolve identity, read or save workspace state, or own live worker lifecycles.
 * Contract: docs/ARCHITECTURE.md GET /api/events under the anonymous viewing policy.
 */
@RestController
public final class EventsController {
    private final RevisionStreams streams;

    public EventsController(RevisionStreams streams) {
        this.streams = streams;
    }

    @GetMapping(value = "/api/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> events(HttpServletRequest request) {
        try {
            return ResponseEntity.ok().header("Cache-Control", "no-store")
                    .header("X-Accel-Buffering", "no").body(streams.open(request));
        } catch (LiveUnavailable exception) {
            throw new ApiFailure(503, exception.getMessage());
        }
    }
}
