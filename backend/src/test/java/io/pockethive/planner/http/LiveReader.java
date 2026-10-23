package io.pockethive.planner.http;

import io.pockethive.planner.domain.WorkspaceJson;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

final class LiveReader implements AutoCloseable {
    private final InputStream source;
    private final BufferedReader reader;

    LiveReader(InputStream source) {
        this.source = source;
        reader = new BufferedReader(new InputStreamReader(source, StandardCharsets.UTF_8));
    }

    BigInteger revisionAtLeast(BigInteger expected) throws Exception {
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var result = executor.submit(() -> {
                String event = null;
                String data = null;
                for (String line; (line = reader.readLine()) != null;) {
                    if (line.startsWith("event:")) {
                        event = line.substring(6).strip();
                    } else if (line.startsWith("data:")) {
                        data = line.substring(5).strip();
                    } else if (line.isEmpty()) {
                        if ("revision".equals(event) && data != null) {
                            BigInteger revision = WorkspaceJson.parse(data.getBytes(StandardCharsets.UTF_8)).get("revision").bigIntegerValue();
                            if (revision.compareTo(expected) >= 0) {
                                return revision;
                            }
                        }
                        event = null;
                        data = null;
                    }
                }
                throw new AssertionError("Live stream ended without the expected revision");
            });
            try {
                return result.get(5, TimeUnit.SECONDS);
            } catch (Exception failure) {
                source.close();
                result.cancel(true);
                throw failure;
            }
        }
    }

    @Override
    public void close() throws IOException {
        source.close();
    }
}
