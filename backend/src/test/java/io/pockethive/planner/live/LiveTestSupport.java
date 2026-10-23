package io.pockethive.planner.live;

import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

final class LiveTestSupport {
    private LiveTestSupport() {}

    static void until(BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(3).toNanos();
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() >= deadline) {
                fail("Live condition did not settle before the deadline");
            }
            Thread.sleep(2);
        }
    }

    static RevisionNotification take(RevisionSubscription subscription) throws InterruptedException {
        RevisionNotification notification = subscription.poll(Duration.ofSeconds(3));
        if (notification == null) {
            fail("Expected a live notification before the deadline");
        }
        return notification;
    }

    static final class Emitter extends SseEmitter {
        final BlockingQueue<List<Object>> frames = new LinkedBlockingQueue<>();
        final AtomicBoolean completed = new AtomicBoolean();
        final CountDownLatch sending = new CountDownLatch(1);
        volatile CountDownLatch blocked;
        volatile boolean ignoreInterrupts;
        volatile boolean failSend;
        private Runnable completion;
        private Runnable timeout;
        private Consumer<Throwable> error;

        @Override
        public void onCompletion(Runnable callback) {
            completion = callback;
        }

        @Override
        public void onTimeout(Runnable callback) {
            timeout = callback;
        }

        @Override
        public void onError(Consumer<Throwable> callback) {
            error = callback;
        }

        @Override
        public void send(SseEventBuilder event) throws IOException {
            sending.countDown();
            CountDownLatch gate = blocked;
            if (gate != null) {
                boolean interrupted = false;
                while (true) {
                    try {
                        gate.await();
                        break;
                    } catch (InterruptedException exception) {
                        if (!ignoreInterrupts) {
                            Thread.currentThread().interrupt();
                            throw new IOException("Synthetic disconnect");
                        }
                        interrupted = true;
                    }
                }
                if (interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
            if (failSend) {
                throw new IOException("Synthetic disconnect");
            }
            frames.add(event.build().stream().map(DataWithMediaType::getData).toList());
        }

        @Override
        public void complete() {
            if (completed.compareAndSet(false, true) && completion != null) {
                completion.run();
            }
        }

        void disconnected() {
            completion.run();
        }

        void timedOut() {
            timeout.run();
        }

        void failed() {
            error.accept(new IOException("Synthetic disconnect"));
        }

        List<Object> next() throws InterruptedException {
            List<Object> frame = frames.poll(3, TimeUnit.SECONDS);
            if (frame == null) {
                fail("Expected an SSE frame before the deadline");
            }
            return frame;
        }
    }
}
