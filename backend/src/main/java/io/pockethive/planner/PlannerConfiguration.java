package io.pockethive.planner;

import io.pockethive.planner.commands.WorkspaceCommands;
import io.pockethive.planner.metadata.VersionInfo;
import io.pockethive.planner.persistence.WorkspaceStore;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.nio.file.Path;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Responsibility: compose the sole Planner state owner from explicit configuration.
 * Must not: provide a working database default, import data or implement domain transitions.
 * Contract: docs/ARCHITECTURE.md one store, validator and transaction clock.
 */
@Configuration(proxyBeanMethods = false)
public class PlannerConfiguration {
    @Bean
    WorkspaceValidator workspaceValidator() {
        return new WorkspaceValidator();
    }

    @Bean
    WorkspaceStore workspaceStore(@Value("${TESTPLANNER_DB}") String database, WorkspaceValidator validator) {
        if (database.isBlank() || !Path.of(database).isAbsolute()) {
            throw new IllegalArgumentException("TESTPLANNER_DB must name an explicit absolute SQLite path");
        }
        return new WorkspaceStore(Path.of(database), Clock.systemUTC(), validator);
    }

    @Bean
    WorkspaceCommands workspaceCommands(WorkspaceStore store, WorkspaceValidator validator) {
        return new WorkspaceCommands(store, validator);
    }

    @Bean
    VersionInfo versionInfo() {
        return VersionInfo.load();
    }
}
