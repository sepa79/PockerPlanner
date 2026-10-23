package io.pockethive.planner.live;

import static io.pockethive.planner.live.LiveTestSupport.until;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTimeout;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigInteger;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class RevisionStreamsTest {
    private final AtomicReference<BigInteger> revision = new AtomicReference<>(BigInteger.ZERO);
    private RevisionFeed feed;
    private RevisionStreams streams;

    @AfterEach
    void stop() {
        if (streams != null) {
            streams.close();
        }
        if (feed != null) {
            feed.stop();
        }
    }

    @Test
    void workersAreLazyAndEmitterIsNotSentAnythingBeforeMvcInitialization() throws Exception {
        LiveTestSupport.Emitter emitter = new LiveTestSupport.Emitter();
        setup(2, Duration.ofMillis(5), () -> emitter);
        assertEquals(0, streams.activeWriters());
        MockHttpServletRequest request = new MockHttpServletRequest();
        streams.open(request);
        assertEquals(1, streams.activeWriters());
        try (RevisionSubscription witness = feed.subscribe()) {
            LiveTestSupport.take(witness);
            revision.set(BigInteger.TEN);
            assertEquals(BigInteger.TEN, LiveTestSupport.take(witness).revision());
        }
        Thread.sleep(20);
        assertTrue(emitter.frames.isEmpty());
        streams.ready(request);
        assertTrue(emitter.next().contains(Map.of("revision", BigInteger.TEN)));
    }

    @Test
    void senderFramesBigIntegerRevisionUnavailableAndCommentHeartbeat() throws Exception {
        LiveTestSupport.Emitter emitter = new LiveTestSupport.Emitter();
        setup(1, Duration.ofMillis(20), () -> emitter);
        MockHttpServletRequest request = new MockHttpServletRequest();
        streams.open(request);
        streams.ready(request);
        var initial = emitter.next();
        assertEquals("event:revision\ndata:", initial.getFirst());
        assertTrue(initial.contains(Map.of("revision", BigInteger.ZERO)));
        assertEquals("\n\n", initial.getLast());
        assertEquals(java.util.List.of(": heartbeat\n\n"), emitter.next());
        revision.set(null);
        var unavailable = nextNotification(emitter);
        assertEquals("event:unavailable\ndata:", unavailable.getFirst());
        assertTrue(unavailable.contains(Map.of()));
        revision.set(BigInteger.ONE.shiftLeft(100));
        assertTrue(nextNotification(emitter).contains(Map.of("revision", revision.get())));
    }

    @Test
    void blockedSenderDoesNotBlockObserverOrOtherClientAndSkipsIntermediateNotification() throws Exception {
        LiveTestSupport.Emitter slow = new LiveTestSupport.Emitter();
        slow.blocked = new CountDownLatch(1);
        LiveTestSupport.Emitter fast = new LiveTestSupport.Emitter();
        AtomicInteger created = new AtomicInteger();
        setup(2, Duration.ofSeconds(30), () -> created.getAndIncrement() == 0 ? slow : fast);
        MockHttpServletRequest slowRequest = new MockHttpServletRequest();
        MockHttpServletRequest fastRequest = new MockHttpServletRequest();
        streams.open(slowRequest);
        streams.open(fastRequest);
        streams.ready(slowRequest);
        streams.ready(fastRequest);
        assertTrue(slow.sending.await(2, TimeUnit.SECONDS));
        assertTrue(fast.next().contains(Map.of("revision", BigInteger.ZERO)));
        revision.set(BigInteger.ONE);
        assertTrue(fast.next().contains(Map.of("revision", BigInteger.ONE)));
        revision.set(BigInteger.TWO);
        assertTrue(fast.next().contains(Map.of("revision", BigInteger.TWO)));
        slow.blocked.countDown();
        assertTrue(slow.next().contains(Map.of("revision", BigInteger.ZERO)));
        assertTrue(slow.next().contains(Map.of("revision", BigInteger.TWO)));
        assertTrue(slow.frames.isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"completion", "timeout", "error"})
    void everyDisconnectCallbackReleasesCapacityAndWaitingWorker(String reason) throws Exception {
        LiveTestSupport.Emitter emitter = new LiveTestSupport.Emitter();
        setup(1, Duration.ofSeconds(30), () -> emitter);
        MockHttpServletRequest request = new MockHttpServletRequest();
        streams.open(request);
        streams.ready(request);
        emitter.next();
        switch (reason) {
            case "completion" -> emitter.disconnected();
            case "timeout" -> emitter.timedOut();
            case "error" -> emitter.failed();
            default -> throw new AssertionError("Unsupported fixture callback");
        }
        until(() -> streams.activeWriters() == 0);
        assertEquals(0, feed.activeSubscriptions());
        assertTrue(emitter.completed.get());
        try (RevisionSubscription reconnect = feed.subscribe()) {
            assertEquals(BigInteger.ZERO, LiveTestSupport.take(reconnect).revision());
        }
    }

    @Test
    void writeFailureReleasesSubscriptionAndDoesNotPoisonFutureClients() throws Exception {
        LiveTestSupport.Emitter broken = new LiveTestSupport.Emitter();
        broken.failSend = true;
        LiveTestSupport.Emitter healthy = new LiveTestSupport.Emitter();
        AtomicInteger created = new AtomicInteger();
        setup(1, Duration.ofSeconds(30), () -> created.getAndIncrement() == 0 ? broken : healthy);
        MockHttpServletRequest first = new MockHttpServletRequest();
        streams.open(first);
        streams.ready(first);
        until(() -> streams.activeWriters() == 0);
        assertEquals(0, feed.activeSubscriptions());
        MockHttpServletRequest reconnect = new MockHttpServletRequest();
        streams.open(reconnect);
        streams.ready(reconnect);
        assertTrue(healthy.next().contains(Map.of("revision", BigInteger.ZERO)));
    }

    @Test
    void workerLimitStillRejectsReconnectWhenDisconnectedSocketWriteCannotBeInterrupted() throws Exception {
        LiveTestSupport.Emitter stuck = new LiveTestSupport.Emitter();
        stuck.blocked = new CountDownLatch(1);
        stuck.ignoreInterrupts = true;
        setup(1, Duration.ofSeconds(30), () -> stuck);
        MockHttpServletRequest first = new MockHttpServletRequest();
        streams.open(first);
        streams.ready(first);
        assertTrue(stuck.sending.await(2, TimeUnit.SECONDS));
        try {
            stuck.disconnected();
            assertEquals(0, feed.activeSubscriptions());
            assertEquals(1, streams.activeWriters());
            assertThrows(LiveUnavailable.class, () -> streams.open(new MockHttpServletRequest()));
            assertEquals(0, feed.activeSubscriptions());
            assertEquals(1, streams.activeWriters());
            assertTimeout(Duration.ofSeconds(2), streams::close);
            assertThrows(LiveUnavailable.class, () -> streams.open(new MockHttpServletRequest()));
        } finally {
            stuck.blocked.countDown();
        }
        until(() -> streams.activeWriters() == 0);
    }

    @Test
    void closeWakesUninitializedWritersAndReleasesAllSubscriptions() throws Exception {
        setup(2, Duration.ofSeconds(30), LiveTestSupport.Emitter::new);
        streams.open(new MockHttpServletRequest());
        streams.open(new MockHttpServletRequest());
        assertEquals(2, feed.activeSubscriptions());
        assertThrows(LiveUnavailable.class, () -> streams.open(new MockHttpServletRequest()));
        assertTimeout(Duration.ofSeconds(2), streams::close);
        streams.close();
        until(() -> streams.activeWriters() == 0);
        assertEquals(0, feed.activeSubscriptions());
        assertThrows(LiveUnavailable.class, () -> streams.open(new MockHttpServletRequest()));
    }

    @Test
    void feedStopWakesInitializedSenderWithoutWaitingForHeartbeat() throws Exception {
        LiveTestSupport.Emitter emitter = new LiveTestSupport.Emitter();
        setup(1, Duration.ofSeconds(30), () -> emitter);
        MockHttpServletRequest request = new MockHttpServletRequest();
        streams.open(request);
        streams.ready(request);
        emitter.next();
        feed.stop();
        until(() -> streams.activeWriters() == 0);
        assertTrue(emitter.completed.get());
        assertEquals(0, feed.activeSubscriptions());
    }

    @Test
    void mvcLifecycleGateOpensOnlyOwnedStreamAndAlwaysReleasesIt() throws Exception {
        LiveTestSupport.Emitter emitter = new LiveTestSupport.Emitter();
        setup(1, Duration.ofSeconds(30), () -> emitter);
        RevisionStreamMvc mvc = new RevisionStreamMvc(streams);
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();
        mvc.afterConcurrentHandlingStarted(request, response, new Object());
        mvc.afterCompletion(request, response, new Object(), null);
        assertEquals(0, streams.activeWriters());
        streams.open(request);
        assertFalse(emitter.completed.get());
        mvc.afterConcurrentHandlingStarted(request, response, new Object());
        assertTrue(emitter.next().contains(Map.of("revision", BigInteger.ZERO)));
        mvc.afterCompletion(request, response, new Object(), null);
        until(() -> streams.activeWriters() == 0);
        assertEquals(0, feed.activeSubscriptions());
    }

    @Test
    void emitterCreationFailureReleasesFeedAndInvalidHeartbeatIsRejected() {
        setup(1, Duration.ofMillis(20), () -> {
            throw new IllegalStateException("Synthetic emitter creation failure");
        });
        assertThrows(IllegalStateException.class, () -> streams.open(new MockHttpServletRequest()));
        assertEquals(0, feed.activeSubscriptions());
        assertEquals(0, streams.activeWriters());
        assertThrows(IllegalArgumentException.class, () -> new RevisionStreams(feed, Duration.ZERO, SseEmitter::new));
        assertThrows(IllegalArgumentException.class,
                () -> new RevisionStreams(feed, Duration.ofMillis(-1), SseEmitter::new));
    }

    private void setup(int maximum, Duration heartbeat, java.util.function.Supplier<SseEmitter> emitters) {
        feed = new RevisionFeed(revision::get, Duration.ofMillis(5), maximum);
        feed.start();
        streams = new RevisionStreams(feed, heartbeat, emitters);
    }

    private java.util.List<Object> nextNotification(LiveTestSupport.Emitter emitter) throws InterruptedException {
        java.util.List<Object> frame;
        do {
            frame = emitter.next();
        } while (frame.size() == 1);
        return frame;
    }
}
