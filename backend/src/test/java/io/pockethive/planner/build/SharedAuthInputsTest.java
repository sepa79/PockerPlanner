package io.pockethive.planner.build;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class SharedAuthInputsTest {
    @TempDir Path temporary;
    private Path backend;
    private Path cache;
    private String version;
    private List<String> classpath;

    @BeforeEach
    void prepareIsolatedCache() throws Exception {
        backend = Path.of(getClass().getProtectionDomain().getCodeSource().getLocation().toURI())
            .getParent().getParent();
        Path vendor = backend.resolve("vendor/maven");
        cache = temporary.resolve("synthetic Maven cache");
        List<String> manifest = Files.readAllLines(vendor.resolve("SHA256SUMS"), StandardCharsets.UTF_8);
        assertEquals(5, manifest.size());
        for (String line : manifest) {
            String relative = line.substring(line.indexOf("  ") + 2);
            Path destination = cache.resolve(relative);
            Files.createDirectories(destination.getParent());
            Files.copy(vendor.resolve(relative), destination);
        }
        version = Path.of(manifest.getFirst().substring(manifest.getFirst().indexOf("  ") + 2))
            .getParent().getFileName().toString();
        classpath = new ArrayList<>(List.of(cache.resolve(relative("auth-client.jar")).toString(),
            cache.resolve(relative("auth-contracts.jar")).toString()));
    }

    @Test
    void acceptsOnlyMatchingResolvedJarAndPomInputsIndependentOfWorkingDirectory() throws Exception {
        classpath.add(temporary.resolve("unrelated dependency.jar").toString());
        assertTrue(verify(0).contains("JAR/POM inputs match the vendored manifest."));
    }

    @ParameterizedTest
    @ValueSource(strings = {"auth-client.jar", "auth-client.pom", "auth-contracts.jar", "auth-contracts.pom", "pockethive-mvp.pom"})
    void rejectsEveryMissingResolvedInput(String artifact) throws Exception {
        Files.delete(cache.resolve(relative(artifact)));
        assertTrue(verify(1).contains("Resolved shared auth JAR/POM inputs do not match"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"auth-client.jar", "auth-client.pom", "auth-contracts.jar", "auth-contracts.pom", "pockethive-mvp.pom"})
    void rejectsEveryTamperedResolvedJarOrPom(String artifact) throws Exception {
        Files.writeString(cache.resolve(relative(artifact)), "synthetic stale artifact", StandardCharsets.UTF_8);
        assertTrue(verify(1).contains("Resolved shared auth JAR/POM inputs do not match"));
    }

    @Test
    void rejectsDuplicateResolvedAuthArtifacts() throws Exception {
        classpath.add(classpath.getFirst());
        assertTrue(verify(1).contains("Expected exactly one resolved auth-client"));
    }

    @Test
    void rejectsAnAbsentResolvedContractsJarEvenWhenItExistsInTheCache() throws Exception {
        classpath.removeLast();
        assertTrue(verify(1).contains("Expected exactly one resolved auth-contracts"));
    }

    @Test
    void rejectsUnexpectedResolvedContractsVersions() throws Exception {
        classpath.add(cache.resolve("io/pockethive/auth-contracts/other/auth-contracts-other.jar").toString());
        assertTrue(verify(1).contains("Unexpected resolved auth-contracts version"));
    }

    @Test
    void rejectsArtifactsResolvedFromDifferentCacheRoots() throws Exception {
        classpath.set(1, temporary.resolve("other cache").resolve(relative("auth-contracts.jar")).toString());
        assertTrue(verify(1).contains("different Maven cache roots"));
    }

    private String relative(String artifactFile) {
        int extension = artifactFile.lastIndexOf('.');
        String artifact = artifactFile.substring(0, extension);
        return "io/pockethive/" + artifact + "/" + version + "/" + artifact + "-" + version
            + artifactFile.substring(extension);
    }

    private String verify(int expectedStatus) throws Exception {
        Path log = temporary.resolve("verification.log");
        Process process = new ProcessBuilder("bash", backend.resolve("scripts/verify-shared-auth.sh").toString(),
            version, String.join(":", classpath)).directory(temporary.toFile()).redirectErrorStream(true)
            .redirectOutput(log.toFile()).start();
        try {
            assertTrue(process.waitFor(10, TimeUnit.SECONDS), "Shared auth verification timed out");
            String output = Files.readString(log, StandardCharsets.UTF_8);
            assertEquals(expectedStatus, process.exitValue(), output);
            return output;
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                process.waitFor(5, TimeUnit.SECONDS);
            }
        }
    }
}
