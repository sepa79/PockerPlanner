package io.pockethive.planner.live;

import io.pockethive.planner.persistence.WorkspaceStore;
import java.math.BigInteger;
import java.time.Duration;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/**
 * Responsibility: observe the sole store's committed revision and notify bounded readers.
 * Must not: save workspace state, resolve identity or wait on a client's network IO.
 * Contract: docs/ARCHITECTURE.md one 0.5-second observer, at most 128 subscriptions.
 */
@Component
public final class RevisionFeed implements SmartLifecycle {
    static final int MAXIMUM_SUBSCRIBERS = 128;
    private static final System.Logger LOGGER = System.getLogger(RevisionFeed.class.getName());
    private final Supplier<BigInteger> revisions;
    private final Duration interval;
    private final int maximum;
    private final Set<RevisionSubscription> subscriptions = new HashSet<>();
    private ScheduledThreadPoolExecutor observer;
    private RevisionNotification current;
    private boolean running;
    private long generation;

    @Autowired
    public RevisionFeed(WorkspaceStore store) {
        this(store::readRevision, Duration.ofMillis(500), MAXIMUM_SUBSCRIBERS);
    }

    RevisionFeed(Supplier<BigInteger> revisions, Duration interval, int maximum) {
        if (interval.isNegative() || interval.isZero() || maximum < 1 || maximum > MAXIMUM_SUBSCRIBERS) {
            throw new IllegalArgumentException("Live observer limits must be positive and bounded");
        }
        this.revisions = revisions;
        this.interval = interval;
        this.maximum = maximum;
    }

    @Override
    public synchronized void start() {
        if (running) {
            return;
        }
        current = observation();
        running = true;
        long startedGeneration = ++generation;
        observer = new ScheduledThreadPoolExecutor(1,
                Thread.ofPlatform().daemon().name("planner-revision-observer").factory());
        observer.setRemoveOnCancelPolicy(true);
        observer.scheduleWithFixedDelay(() -> observe(startedGeneration),
                interval.toNanos(), interval.toNanos(), TimeUnit.NANOSECONDS);
    }

    synchronized RevisionSubscription subscribe() {
        if (!running) {
            throw new LiveUnavailable("Live updates are unavailable. Reconnect shortly.");
        }
        if (subscriptions.size() >= maximum) {
            throw new LiveUnavailable("Live updates are at capacity. Reconnect shortly.");
        }
        RevisionSubscription subscription = new RevisionSubscription(this::release);
        subscriptions.add(subscription);
        subscription.offer(current);
        return subscription;
    }

    private synchronized void release(RevisionSubscription subscription) {
        subscriptions.remove(subscription);
    }

    private RevisionNotification observation() {
        try {
            return new RevisionNotification(java.util.Objects.requireNonNull(revisions.get()));
        } catch (RuntimeException exception) {
            return RevisionNotification.unavailable();
        }
    }

    private void observe(long observedGeneration) {
        RevisionNotification next = observation();
        synchronized (this) {
            if (running && observedGeneration == generation && !next.equals(current)) {
                if (next.revision() == null) {
                    LOGGER.log(System.Logger.Level.WARNING, "Live revision observation is unavailable");
                }
                current = next;
                subscriptions.forEach(subscription -> subscription.offer(next));
            }
        }
    }

    int maximumSubscribers() {
        return maximum;
    }

    synchronized int activeSubscriptions() {
        return subscriptions.size();
    }

    @Override
    public synchronized boolean isRunning() {
        return running;
    }

    @Override
    public void stop() {
        ScheduledThreadPoolExecutor stopping;
        Set<RevisionSubscription> closing;
        synchronized (this) {
            if (!running) {
                return;
            }
            running = false;
            stopping = observer;
            observer = null;
            current = null;
            closing = Set.copyOf(subscriptions);
            subscriptions.clear();
        }
        stopping.shutdownNow();
        closing.forEach(RevisionSubscription::close);
        try {
            stopping.awaitTermination(1, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
    }
}
