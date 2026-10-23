package io.pockethive.planner.live;

import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Responsibility: retain only the latest notification for one bounded subscription.
 * Must not: block a publisher, perform network IO or retain a replay buffer.
 * Contract: docs/ARCHITECTURE.md one pending event per client and idempotent release.
 */
final class RevisionSubscription implements AutoCloseable {
    private final ArrayBlockingQueue<RevisionNotification> pending = new ArrayBlockingQueue<>(1);
    private final AtomicBoolean closed = new AtomicBoolean();
    private final Consumer<RevisionSubscription> released;

    RevisionSubscription(Consumer<RevisionSubscription> released) {
        this.released = released;
    }

    synchronized void offer(RevisionNotification notification) {
        if (!closed.get()) {
            pending.poll();
            pending.offer(notification);
        }
    }

    RevisionNotification poll(Duration timeout) throws InterruptedException {
        if (closed.get()) {
            return null;
        }
        return pending.poll(timeout.toNanos(), TimeUnit.NANOSECONDS);
    }

    boolean isClosed() {
        return closed.get();
    }

    int pendingCount() {
        return closed.get() ? 0 : pending.size();
    }

    @Override
    public void close() {
        synchronized (this) {
            if (!closed.compareAndSet(false, true)) {
                return;
            }
            pending.clear();
            pending.offer(RevisionNotification.unavailable());
        }
        released.accept(this);
    }
}
