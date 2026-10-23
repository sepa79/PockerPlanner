package io.pockethive.planner.http;

import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.RevisionConflict;
import io.pockethive.planner.persistence.WorkspaceUnavailable;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;

/**
 * Responsibility: map typed failures to safe API error responses.
 * Must not: expose exception internals, retry mutations or make authorization decisions.
 * Contract: docs/ARCHITECTURE.md HTTP 400/401/403/409/503 and generic server failures.
 */
@RestControllerAdvice
public final class ApiErrors {
    private static final Logger LOG = LoggerFactory.getLogger(ApiErrors.class);

    @ExceptionHandler(InvalidWorkspace.class)
    ResponseEntity<?> invalid(InvalidWorkspace failure) {
        return error(400, failure.getMessage());
    }

    @ExceptionHandler(RevisionConflict.class)
    ResponseEntity<?> conflict(RevisionConflict failure) {
        return error(409, failure.getMessage());
    }

    @ExceptionHandler(ApiFailure.class)
    ResponseEntity<?> explicit(ApiFailure failure) {
        return error(failure.status(), failure.getMessage());
    }

    @ExceptionHandler(WorkspaceUnavailable.class)
    ResponseEntity<?> unavailable() {
        return error(503, "Planner workspace is unavailable");
    }

    @ExceptionHandler(AsyncRequestNotUsableException.class)
    void disconnected() {}

    @ExceptionHandler({NoHandlerFoundException.class, NoResourceFoundException.class})
    ResponseEntity<?> missing() {
        return error(404, "Not found");
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<?> method() {
        return error(405, "Method not allowed");
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<?> unexpected(Exception failure) {
        LOG.error("Planner request failed: {}", failure.getClass().getSimpleName());
        return error(500, "Unable to serve planner");
    }

    private static ResponseEntity<?> error(int status, String message) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", message));
    }
}
