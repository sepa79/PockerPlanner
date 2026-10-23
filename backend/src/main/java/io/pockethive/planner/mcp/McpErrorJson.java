package io.pockethive.planner.mcp;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Responsibility: suppress Throwable diagnostics in the official transport's error serialization.
 * Must not: replace SDK protocol errors or change the application's shared JSON mapper.
 * Contract: docs/MCP.md safe transport failures with no internal stack traces or causes.
 */
@JsonIgnoreProperties({"cause", "stackTrace", "suppressed", "localizedMessage"})
abstract class McpErrorJson {}
