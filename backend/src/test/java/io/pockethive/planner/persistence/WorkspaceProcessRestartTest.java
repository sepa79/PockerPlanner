package io.pockethive.planner.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class WorkspaceProcessRestartTest {
    @TempDir Path temporary;

    @Test
    void committedLifecycleFactsSurviveARealJvmProcessRestart() throws Exception {
        run("write");
        run("read");
    }

    private void run(String operation) throws Exception {
        Path log = temporary.resolve(operation + ".log");
        Process process = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp", System.getProperty("java.class.path"), WorkspaceProcessProbe.class.getName(), operation,
                temporary.resolve("process.sqlite3").toString()).redirectErrorStream(true).redirectOutput(log.toFile()).start();
        try {
            assertTrue(process.waitFor(15, TimeUnit.SECONDS), "Synthetic process probe timed out");
            assertEquals(0, process.exitValue(), () -> {
                try {
                    return java.nio.file.Files.readString(log, StandardCharsets.UTF_8);
                } catch (java.io.IOException exception) {
                    return "Cannot read synthetic process probe output";
                }
            });
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
            }
        }
    }
}
