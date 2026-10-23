package io.pockethive.planner.http;

import java.io.IOException;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Responsibility: serve the built React entry document from the application artifact.
 * Must not: read workspace data, infer callbacks or proxy another runtime.
 * Contract: docs/ARCHITECTURE.md shared React frontend with hash-based product routes.
 */
@RestController
public final class FrontendController {
    @GetMapping(value = {"/", "/index.html"}, produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<byte[]> index() throws IOException {
        ClassPathResource resource = new ClassPathResource("static/index.html");
        if (!resource.exists()) {
            throw new ApiFailure(503, "Build the Planner frontend before packaging the application.");
        }
        return ResponseEntity.ok().contentType(MediaType.TEXT_HTML).body(resource.getContentAsByteArray());
    }
}
