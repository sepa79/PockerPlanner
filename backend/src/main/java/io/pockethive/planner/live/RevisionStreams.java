package io.pockethive.planner.live;

import jakarta.annotation.PreDestroy;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Responsibility: admit and execute SSE writers with a hard lazy worker limit and no task queue.
 * Must not: perform state observation, choose identity or let blocked clients grow resources.
 * Contract: docs/ARCHITECTURE.md at most 128 streams and 15-second comment heartbeats.
 */
@Component
public final class RevisionStreams implements AutoCloseable {
    private static final String REQUEST_STREAM = RevisionStreams.class.getName() + ".stream";
    private final RevisionFeed feed;
    private final Duration heartbeat;
    private final Supplier<SseEmitter> emitters;
    private final Set<RevisionStream> streams = ConcurrentHashMap.newKeySet();
    private final ThreadPoolExecutor writers;
    private boolean closed;

    @Autowired
    public RevisionStreams(RevisionFeed feed) {
        this(feed, Duration.ofSeconds(15), () -> new SseEmitter(0L));
    }

    RevisionStreams(RevisionFeed feed, Duration heartbeat, Supplier<SseEmitter> emitters) {
        if (heartbeat.isNegative() || heartbeat.isZero()) {
            throw new IllegalArgumentException("Live heartbeat interval must be positive");
        }
        this.feed = feed;
        this.heartbeat = heartbeat;
        this.emitters = emitters;
        writers = new ThreadPoolExecutor(0, feed.maximumSubscribers(), 30, TimeUnit.SECONDS,
                new SynchronousQueue<>(), Thread.ofVirtual().name("planner-live-send-", 0).factory(),
                new ThreadPoolExecutor.AbortPolicy());
    }

    public synchronized SseEmitter open(HttpServletRequest request) {
        if (closed) {
            throw new LiveUnavailable("Live updates are unavailable. Reconnect shortly.");
        }
        RevisionSubscription subscription = feed.subscribe();
        try {
            SseEmitter emitter = emitters.get();
            RevisionStream stream = new RevisionStream(subscription, emitter, heartbeat, streams::remove);
            streams.add(stream);
            request.setAttribute(REQUEST_STREAM, stream);
            try {
                writers.execute(stream);
            } catch (RejectedExecutionException exception) {
                streams.remove(stream);
                request.removeAttribute(REQUEST_STREAM);
                stream.close();
                throw new LiveUnavailable("Live updates are at capacity. Reconnect shortly.");
            }
            return emitter;
        } catch (RuntimeException exception) {
            subscription.close();
            throw exception;
        }
    }

    void ready(HttpServletRequest request) {
        if (request.getAttribute(REQUEST_STREAM) instanceof RevisionStream stream) {
            stream.ready();
        }
    }

    void release(HttpServletRequest request) {
        if (request.getAttribute(REQUEST_STREAM) instanceof RevisionStream stream) {
            stream.close();
        }
    }

    int activeWriters() {
        return streams.size();
    }

    @Override
    @PreDestroy
    public void close() {
        synchronized (this) {
            if (closed) {
                return;
            }
            closed = true;
            streams.forEach(RevisionStream::close);
            writers.shutdownNow();
        }
        try {
            writers.awaitTermination(1, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
    }
}
