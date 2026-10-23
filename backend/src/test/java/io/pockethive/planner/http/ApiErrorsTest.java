package io.pockethive.planner.http;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.pockethive.planner.live.RevisionFeed;
import io.pockethive.planner.live.RevisionStreams;
import io.pockethive.planner.persistence.WorkspaceStore;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.nio.file.Path;
import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ApiErrorsTest {
    @TempDir Path temporary;

    @Test
    void anUnavailableEventStreamStillReturns503JsonWhenTheClientRequestsOnlySse() throws Exception {
        WorkspaceStore store = new WorkspaceStore(temporary.resolve("errors.sqlite3"), Clock.systemUTC(), new WorkspaceValidator());
        RevisionFeed feed = new RevisionFeed(store);
        try (RevisionStreams streams = new RevisionStreams(feed)) {
            var mvc = MockMvcBuilders.standaloneSetup(new EventsController(streams)).setControllerAdvice(new ApiErrors()).build();
            mvc.perform(get("/api/events").accept(MediaType.TEXT_EVENT_STREAM)).andExpect(status().isServiceUnavailable())
                    .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                    .andExpect(content().json("{\"error\":\"Live updates are unavailable. Reconnect shortly.\"}"));
        }
    }
}
