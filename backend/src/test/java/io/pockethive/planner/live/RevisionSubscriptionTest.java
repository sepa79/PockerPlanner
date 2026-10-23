package io.pockethive.planner.live;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTimeout;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class RevisionSubscriptionTest {
    @Test
    void onlyLatestNotificationSurvivesWithoutBlockingPublisher() throws Exception {
        try (RevisionSubscription subscription = new RevisionSubscription(ignored -> {})) {
            assertTimeout(Duration.ofSeconds(2), () -> {
                for (int revision = 0; revision <= 10000; revision++) {
                    subscription.offer(new RevisionNotification(BigInteger.valueOf(revision)));
                    assertEquals(1, subscription.pendingCount());
                }
            });
            assertEquals(BigInteger.valueOf(10000), LiveTestSupport.take(subscription).revision());
            assertEquals(0, subscription.pendingCount());
            assertNull(subscription.poll(Duration.ofMillis(5)));
        }
    }

    @Test
    void closeWakesWaitingReaderReleasesExactlyOnceAndRejectsFurtherNotifications() throws Exception {
        AtomicInteger released = new AtomicInteger();
        RevisionSubscription subscription = new RevisionSubscription(ignored -> released.incrementAndGet());
        CompletableFuture<RevisionNotification> waiting = new CompletableFuture<>();
        Thread reader = Thread.ofVirtual().start(() -> {
            try {
                waiting.complete(subscription.poll(Duration.ofSeconds(30)));
            } catch (InterruptedException exception) {
                waiting.completeExceptionally(exception);
            }
        });
        subscription.close();
        subscription.close();
        waiting.get(2, TimeUnit.SECONDS);
        reader.join(2000);
        subscription.offer(new RevisionNotification(BigInteger.ONE));
        assertEquals(1, released.get());
        assertTrue(subscription.isClosed());
        assertEquals(0, subscription.pendingCount());
        assertNull(subscription.poll(Duration.ofSeconds(30)));
    }

    @Test
    void notificationsPreserveBigIntegerAndNeverExposeDiagnostics() {
        BigInteger revision = BigInteger.ONE.shiftLeft(200);
        RevisionNotification available = new RevisionNotification(revision);
        assertEquals("revision", available.event());
        assertEquals(Map.of("revision", revision), available.data());
        assertEquals("unavailable", RevisionNotification.unavailable().event());
        assertEquals(Map.of(), RevisionNotification.unavailable().data());
        assertThrows(IllegalArgumentException.class, () -> new RevisionNotification(BigInteger.valueOf(-1)));
    }
}
