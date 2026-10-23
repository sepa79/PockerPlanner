package io.pockethive.planner.mcp;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import java.io.ByteArrayInputStream;

/**
 * Responsibility: supply already bounded request bytes to the synchronous SDK servlet.
 * Must not: read unbounded network input or start asynchronous IO.
 * Contract: docs/MCP.md one request-local byte buffer, no transport state.
 */
final class McpBodyInputStream extends ServletInputStream {
    private final ByteArrayInputStream input;

    McpBodyInputStream(byte[] body) {
        input = new ByteArrayInputStream(body);
    }

    @Override
    public int read() {
        return input.read();
    }

    @Override
    public int read(byte[] bytes, int offset, int length) {
        return input.read(bytes, offset, length);
    }

    @Override
    public boolean isFinished() {
        return input.available() == 0;
    }

    @Override
    public boolean isReady() {
        return true;
    }

    @Override
    public void setReadListener(ReadListener listener) {
        throw new IllegalStateException("MCP request replay uses synchronous IO");
    }
}
