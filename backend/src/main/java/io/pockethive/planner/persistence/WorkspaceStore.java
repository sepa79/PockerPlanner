package io.pockethive.planner.persistence;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.pockethive.planner.domain.ActivityKey;
import io.pockethive.planner.domain.InvalidWorkspace;
import io.pockethive.planner.domain.RevisionConflict;
import io.pockethive.planner.domain.WorkspaceJson;
import io.pockethive.planner.domain.WorkspaceLimits;
import io.pockethive.planner.execution.ExecutionRecorder;
import io.pockethive.planner.execution.IssueResolutions;
import io.pockethive.planner.validation.WorkspaceValidator;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.function.Function;

/**
 * Responsibility: own atomic workspace persistence, revisions and factual composition.
 * Must not: expose HTTP, authorize users, project calendars or select a default database.
 * Contract: docs/ARCHITECTURE.md single SQLite writer and transactional lifecycle updates.
 */
public final class WorkspaceStore {
    private final Path database;
    private final Clock clock;
    private final WorkspaceValidator validator;

    public WorkspaceStore(Path database, Clock clock, WorkspaceValidator validator) {
        this.database = database.toAbsolutePath().normalize();
        this.clock = clock;
        this.validator = validator;
        initialize();
    }

    public ObjectNode read() {
        try (Connection connection = connect()) {
            return select(connection);
        } catch (SQLException exception) {
            throw new WorkspaceUnavailable(exception);
        }
    }

    public BigInteger readRevision() {
        return read().get("revision").bigIntegerValue();
    }

    public ObjectNode write(ObjectNode document) {
        return write(document, Map.of());
    }

    public ObjectNode write(ObjectNode document, Map<ActivityKey, ObjectNode> actions) {
        if (document == null) {
            throw new InvalidWorkspace("Supply a workspace document");
        }
        ObjectNode proposed = document.deepCopy();
        validator.validate(proposed);
        Map<ActivityKey, ObjectNode> captured = actions.entrySet().stream().collect(
                java.util.stream.Collectors.toUnmodifiableMap(Map.Entry::getKey, entry -> entry.getValue().deepCopy()));
        return transaction(proposed.get("revision").bigIntegerValue(), current -> {
            Instant now = clock.instant().truncatedTo(ChronoUnit.SECONDS);
            IssueResolutions.record(proposed, current, now);
            ExecutionRecorder.record(proposed, current, captured, now);
            proposed.put("revision", current.get("revision").bigIntegerValue().add(BigInteger.ONE));
            return proposed;
        });
    }

    public ObjectNode replaceExplicitly(ObjectNode document) {
        if (document == null) {
            throw new InvalidWorkspace("Supply a workspace document");
        }
        ObjectNode proposed = document.deepCopy();
        validator.validate(proposed);
        return transaction(proposed.get("revision").bigIntegerValue(), current -> {
            ObjectNode noHistory = WorkspaceJson.object();
            noHistory.set("plans", WorkspaceJson.array());
            IssueResolutions.record(proposed, noHistory, clock.instant().truncatedTo(ChronoUnit.SECONDS));
            proposed.put("revision", current.get("revision").bigIntegerValue().add(BigInteger.ONE));
            return proposed;
        });
    }

    private ObjectNode transaction(BigInteger expectedRevision, Function<ObjectNode, ObjectNode> operation) {
        try (Connection connection = connect()) {
            execute(connection, "BEGIN IMMEDIATE");
            try {
                ObjectNode current = select(connection);
                if (!expectedRevision.equals(current.get("revision").bigIntegerValue())) {
                    throw new RevisionConflict();
                }
                ObjectNode saved = operation.apply(current);
                validator.validate(saved);
                byte[] bytes = WorkspaceJson.encode(saved);
                ObjectNode canonical = WorkspaceJson.parse(bytes);
                try (var statement = connection.prepareStatement("UPDATE planner SET document = ? WHERE id = 1")) {
                    statement.setString(1, new String(bytes, StandardCharsets.UTF_8));
                    if (statement.executeUpdate() != 1) {
                        throw new InvalidWorkspace("Planner has not been initialized");
                    }
                }
                execute(connection, "COMMIT");
                return canonical;
            } catch (RuntimeException | SQLException exception) {
                rollback(connection, exception);
                throw exception;
            }
        } catch (SQLException exception) {
            throw new WorkspaceUnavailable(exception);
        }
    }

    private ObjectNode select(Connection connection) throws SQLException {
        try (var statement = connection.prepareStatement("SELECT document FROM planner WHERE id = 1");
             ResultSet result = statement.executeQuery()) {
            if (!result.next()) {
                throw new InvalidWorkspace("Planner has not been initialized");
            }
            ObjectNode document = WorkspaceJson.parse(result.getString(1).getBytes(StandardCharsets.UTF_8));
            validator.validate(document);
            return document;
        }
    }

    private void initialize() {
        try {
            Files.createDirectories(database.getParent());
        } catch (IOException exception) {
            throw new WorkspaceUnavailable(exception);
        }
        try (Connection connection = connect()) {
            execute(connection, "CREATE TABLE IF NOT EXISTS planner (id INTEGER PRIMARY KEY CHECK(id = 1), document TEXT NOT NULL)");
            try (var statement = connection.prepareStatement("INSERT OR IGNORE INTO planner (id, document) VALUES (1, ?)")) {
                statement.setString(1, new String(WorkspaceJson.encode(seed()), StandardCharsets.UTF_8));
                statement.executeUpdate();
            }
            select(connection);
        } catch (SQLException exception) {
            throw new WorkspaceUnavailable(exception);
        }
    }

    private ObjectNode seed() {
        try (InputStream input = WorkspaceStore.class.getResourceAsStream("/seed.json")) {
            if (input == null) {
                throw new InvalidWorkspace("Planner seed is unavailable");
            }
            ObjectNode document = WorkspaceJson.parse(input.readNBytes(WorkspaceLimits.MAX_DOCUMENT_BYTES + 1));
            validator.validate(document);
            return document;
        } catch (IOException exception) {
            throw new WorkspaceUnavailable(exception);
        }
    }

    private Connection connect() throws SQLException {
        Connection connection = DriverManager.getConnection("jdbc:sqlite:" + database);
        try (var statement = connection.createStatement()) {
            statement.execute("PRAGMA busy_timeout = 10000");
        } catch (SQLException exception) {
            connection.close();
            throw exception;
        }
        return connection;
    }

    private static void rollback(Connection connection, Exception original) {
        try (var statement = connection.createStatement()) {
            statement.execute("ROLLBACK");
        } catch (SQLException exception) {
            original.addSuppressed(exception);
        }
    }

    private static void execute(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }
}
