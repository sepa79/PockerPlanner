package io.pockethive.planner.live;

import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Responsibility: serialize one subscriber's notifications and heartbeats to its emitter.
 * Must not: send before MVC initializes the emitter, read state or buffer extra events.
 * Contract: docs/ARCHITECTURE.md bounded latest delivery, heartbeat and disconnect cleanup.
 */
final class RevisionStream implements Runnable, AutoCloseable {
    private final RevisionSubscription subscription;
    private final SseEmitter emitter;
    private final Duration heartbeat;
    private final Consumer<RevisionStream> finished;
    private final CountDownLatch ready = new CountDownLatch(1);
    private final AtomicBoolean closed = new AtomicBoolean();
    private volatile Thread worker;

    RevisionStream(RevisionSubscription subscription, SseEmitter emitter, Duration heartbeat, Consumer<RevisionStream> finished) {
        this.subscription = subscription;
        this.emitter = emitter;
        this.heartbeat = heartbeat;
        this.finished = finished;
        emitter.onCompletion(this::close);
        emitter.onTimeout(this::close);
        emitter.onError(error -> close());
    }

    void ready() {
        ready.countDown();
    }

    @Override
    public void run() {
        worker = Thread.currentThread();
        try {
            ready.await();
            while (!closed.get() && !subscription.isClosed()) {
                RevisionNotification notification = subscription.poll(heartbeat);
                if (closed.get() || subscription.isClosed()) {
                    break;
                }
                if (notification == null) {
                    emitter.send(SseEmitter.event().comment(" heartbeat"));
                } else {
                    emitter.send(SseEmitter.event().name(notification.event())
                            .data(notification.data(), MediaType.APPLICATION_JSON));
                }
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        } catch (IOException | IllegalStateException exception) {
            close();
        } finally {
            close();
            try {
                emitter.complete();
            } finally {
                finished.accept(this);
            }
        }
    }

    @Override
    public void close() {
        if (closed.compareAndSet(false, true)) {
            subscription.close();
            ready.countDown();
            Thread sending = worker;
            if (sending != null && sending != Thread.currentThread()) {
                sending.interrupt();
            }
        }
    }
}
