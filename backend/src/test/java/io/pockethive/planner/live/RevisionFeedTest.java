package io.pockethive.planner.live;

import static io.pockethive.planner.live.LiveTestSupport.take;
import static io.pockethive.planner.live.LiveTestSupport.until;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.pockethive.planner.commands.WorkspaceCommands;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.persistence.WorkspaceStore;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.math.BigInteger;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RevisionFeedTest {
    @TempDir Path temporary;
    private final List<RevisionFeed> feeds = new ArrayList<>();

    @AfterEach
    void stop() {
        feeds.forEach(RevisionFeed::stop);
    }

    @Test
    void readsActualCommittedWritesCommandsAndIndependentExplicitImports() throws Exception {
        WorkspaceValidator validator = new WorkspaceValidator();
        Path database = temporary.resolve("live.sqlite3");
        WorkspaceStore store = new WorkspaceStore(database, Clock.systemUTC(), validator);
        var before = store.read();
        RevisionFeed feed = feed(store::readRevision, 2);
        try (RevisionSubscription first = feed.subscribe(); RevisionSubscription second = feed.subscribe()) {
            assertEquals(BigInteger.ZERO, take(first).revision());
            assertEquals(BigInteger.ZERO, take(second).revision());
            assertEquals(before, store.read());
            store.write(store.read());
            assertEquals(BigInteger.ONE, take(first).revision());
            assertEquals(BigInteger.ONE, take(second).revision());
            new WorkspaceCommands(store, validator).createPlan("live", "Live", "", BigInteger.ONE, null);
            assertEquals(BigInteger.TWO, take(first).revision());
            assertEquals(BigInteger.TWO, take(second).revision());
            WorkspaceStore external = new WorkspaceStore(database, Clock.systemUTC(), validator);
            var replacement = WorkspaceJson.object().put("schemaVersion", 1).put("revision", external.readRevision());
            replacement.set("plans", WorkspaceJson.array());
            external.replaceExplicitly(replacement);
            assertEquals(BigInteger.valueOf(3), take(first).revision());
            assertEquals(BigInteger.valueOf(3), take(second).revision());
            assertNull(first.poll(Duration.ofMillis(30)));
        }
    }

    @Test
    void failedSaveDoesNotAdvanceOrPublish() throws Exception {
        WorkspaceStore store = new WorkspaceStore(temporary.resolve("failed.sqlite3"), Clock.systemUTC(),
                new WorkspaceValidator());
        RevisionFeed feed = feed(store::readRevision, 1);
        try (RevisionSubscription subscription = feed.subscribe()) {
            take(subscription);
            assertThrows(InvalidWorkspace.class, () -> store.write(WorkspaceJson.object()));
            assertNull(subscription.poll(Duration.ofMillis(50)));
            assertEquals(BigInteger.ZERO, store.readRevision());
        }
    }

    @Test
    void outageNotifiesOnceReconnectsSeeItAndSameRevisionRecoveryIsAnnounced() throws Exception {
        AtomicBoolean failing = new AtomicBoolean();
        RevisionFeed feed = feed(() -> {
            if (failing.get()) {
                throw new IllegalStateException("Synthetic secret must not reach clients");
            }
            return BigInteger.ZERO;
        }, 2);
        try (RevisionSubscription subscription = feed.subscribe()) {
            assertEquals(BigInteger.ZERO, take(subscription).revision());
            failing.set(true);
            assertEquals(RevisionNotification.unavailable(), take(subscription));
            assertNull(subscription.poll(Duration.ofMillis(30)));
            try (RevisionSubscription reconnect = feed.subscribe()) {
                assertEquals(RevisionNotification.unavailable(), take(reconnect));
                failing.set(false);
                assertEquals(BigInteger.ZERO, take(subscription).revision());
                assertEquals(BigInteger.ZERO, take(reconnect).revision());
            }
        }
    }

    @Test
    void failedInitialObservationDoesNotPreventRecovery() throws Exception {
        AtomicReference<BigInteger> available = new AtomicReference<>();
        RevisionFeed feed = feed(available::get, 1);
        try (RevisionSubscription subscription = feed.subscribe()) {
            assertEquals("unavailable", take(subscription).event());
            available.set(BigInteger.ONE.shiftLeft(100));
            assertEquals(available.get(), take(subscription).revision());
        }
    }

    @Test
    void slowSubscriberKeepsOneLatestObservationWhileOtherSubscriberContinues() throws Exception {
        AtomicReference<BigInteger> revision = new AtomicReference<>(BigInteger.ZERO);
        RevisionFeed feed = feed(revision::get, 2);
        try (RevisionSubscription slow = feed.subscribe(); RevisionSubscription fast = feed.subscribe()) {
            take(fast);
            for (int number = 1; number <= 10; number++) {
                revision.set(BigInteger.valueOf(number));
                assertEquals(revision.get(), take(fast).revision());
                assertEquals(1, slow.pendingCount());
            }
            assertEquals(BigInteger.TEN, take(slow).revision());
        }
    }

    @Test
    void maximumCapacityIs128AndCloseReleasesItIdempotently() {
        RevisionFeed feed = feed(() -> BigInteger.ZERO, 128);
        List<RevisionSubscription> subscriptions = new ArrayList<>();
        for (int index = 0; index < 128; index++) {
            subscriptions.add(feed.subscribe());
        }
        assertEquals(128, feed.activeSubscriptions());
        assertThrows(LiveUnavailable.class, feed::subscribe);
        subscriptions.getFirst().close();
        subscriptions.getFirst().close();
        assertEquals(127, feed.activeSubscriptions());
        subscriptions.add(feed.subscribe());
        assertEquals(128, feed.activeSubscriptions());
        subscriptions.forEach(RevisionSubscription::close);
        assertEquals(0, feed.activeSubscriptions());
    }

    @Test
    void stopClosesSubscriptionsStopsObserverAndRestartReadsCurrentStore() throws Exception {
        AtomicInteger observations = new AtomicInteger();
        AtomicReference<BigInteger> revision = new AtomicReference<>(BigInteger.ZERO);
        RevisionFeed feed = feed(() -> {
            observations.incrementAndGet();
            return revision.get();
        }, 2);
        RevisionSubscription subscription = feed.subscribe();
        feed.start();
        feed.stop();
        feed.stop();
        int stoppedCount = observations.get();
        assertFalse(feed.isRunning());
        assertTrue(subscription.isClosed());
        assertEquals(0, feed.activeSubscriptions());
        assertThrows(LiveUnavailable.class, feed::subscribe);
        Thread.sleep(20);
        assertEquals(stoppedCount, observations.get());
        revision.set(BigInteger.TEN);
        feed.start();
        try (RevisionSubscription reconnect = feed.subscribe()) {
            assertEquals(BigInteger.TEN, take(reconnect).revision());
        }
    }

    @Test
    void oneObserverServesAllSubscribersAndDuplicateStartDoesNotCreateAnother() throws Exception {
        Set<Long> observerThreads = ConcurrentHashMap.newKeySet();
        AtomicInteger observations = new AtomicInteger();
        long caller = Thread.currentThread().threadId();
        RevisionFeed feed = feed(() -> {
            if (Thread.currentThread().threadId() != caller) {
                observerThreads.add(Thread.currentThread().threadId());
            }
            observations.incrementAndGet();
            return BigInteger.ZERO;
        }, 3);
        feed.subscribe();
        feed.subscribe();
        feed.subscribe();
        feed.start();
        until(() -> observations.get() >= 5);
        assertEquals(1, observerThreads.size());
    }

    @Test
    void invalidObserverLimitsAreRejectedAndStoppedFeedDoesNotAdmitReaders() {
        assertThrows(IllegalArgumentException.class, () -> new RevisionFeed(() -> BigInteger.ZERO, Duration.ZERO, 1));
        assertThrows(IllegalArgumentException.class, () -> new RevisionFeed(() -> BigInteger.ZERO, Duration.ofMillis(-1), 1));
        assertThrows(IllegalArgumentException.class, () -> new RevisionFeed(() -> BigInteger.ZERO, Duration.ofMillis(1), 129));
        assertThrows(IllegalArgumentException.class, () -> new RevisionFeed(() -> BigInteger.ZERO, Duration.ofMillis(1), 0));
        RevisionFeed stopped = new RevisionFeed(() -> BigInteger.ZERO, Duration.ofMillis(1), 1);
        assertThrows(LiveUnavailable.class, stopped::subscribe);
    }

    private RevisionFeed feed(Supplier<BigInteger> revisions, int maximum) {
        RevisionFeed feed = new RevisionFeed(revisions, Duration.ofMillis(5), maximum);
        feeds.add(feed);
        feed.start();
        return feed;
    }
}
