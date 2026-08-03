# handrail-mcp

`handrail-mcp` is the sole project-side MCP connector for Handrail. This
repository owns the connector's standard MCP transports, tool/resource/prompt
schemas, minimal internal Handrail HTTP client, package and CLI entrypoints,
tests, and releases.

The central Handrail application remains the source of truth for the versioned
REST API, authentication, service-bound capabilities and credentials,
issuer-plus-subject policy, durable intake/status/audit records, canonical Work
Request routing, release evidence, Knowledge Base content, and compatibility
catalog. Consumer SDKs, including `@handrail/sdk-node`, do not own or distribute
this connector contract.

## Canonical connector contract

Connector conformance targets the authenticated Handrail discovery endpoint:

```text
GET /api/assistant-change-bridge/v1/discovery
```

That versioned central API endpoint is the canonical contract reference for
the connector. Conformance tests in this repository must exercise the endpoint
through Handrail's API test harness and the operations it advertises; they must
not retain a copied SDK fixture or a second contract definition.
