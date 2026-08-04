# handrail-mcp

`@handrail/mcp` is the sole project-side MCP connector for Handrail. It exposes
the versioned central Handrail REST API through standard MCP tools, resources,
prompts, and transports. The connector is deliberately stateless: Handrail
owns authentication, authorization, policy, durable intake/status/audit data,
PM and Work Request lifecycles, Knowledge Base content, and compatibility.

Current connector version: `0.1.0`. Central API contract: `v1`.

## Runtime contract

The selected server service receives these values from Handrail's
service-bound capability injection. The connector is default-deny and exposes
no tools unless every required value is present.

```text
HANDRAIL_ASSISTANT_BRIDGE_ENABLED=true
HANDRAIL_ASSISTANT_BRIDGE_API_URL=https://handrail.example/api/assistant-change-bridge/v1
HANDRAIL_ASSISTANT_BRIDGE_VERSION=v1
HANDRAIL_ASSISTANT_BRIDGE_PROJECT_ID=...
HANDRAIL_ASSISTANT_BRIDGE_CAPABILITY_ID=...
HANDRAIL_ASSISTANT_BRIDGE_TOKEN=...
HANDRAIL_ASSISTANT_PRINCIPAL_ISSUER=...
HANDRAIL_ASSISTANT_PRINCIPAL_SUBJECT=...
```

The bearer credential is server-only. Do not put it in repository env files,
browser/mobile configuration, tool arguments, logs, or assistant context.
Issuer and subject are also server-bound configuration rather than tool
arguments, so an assistant cannot select another identity through prompt text.
Revocation and policy changes are enforced by the central API on each call.

## CLI and transports

Node.js 20 or newer is required.

```sh
npx --package @handrail/mcp@0.1.0 handrail-mcp --transport stdio
npx --package @handrail/mcp@0.1.0 handrail-mcp --transport http --host 127.0.0.1 --port 3000 --path /mcp
handrail-mcp --version
```

The supported standard transports are stdio and stateless Streamable HTTP.
HTTP binds to loopback by default; authentication and network exposure remain
the host deployment's responsibility.

The discovery response decides which of these canonical tools are registered:

- `assistant_change_bridge_v1_discover`
- `assistant_change_bridge_v1_submit`
- `assistant_change_bridge_v1_lookup`
- `assistant_change_bridge_v1_clarify`
- `assistant_change_bridge_v1_cancel`

Knowledge Base resources and prompt descriptors are also obtained from central
discovery. Their bodies are fetched from same-origin paths beneath the bound
versioned API when invoked; no KB body or prompt implementation is packaged.

## Safety and errors

Only discovery, lookup, idempotent submit, and safe cancellation receive
bounded retries (`2` by default). Clarification is not retried because it is
not idempotent. Retryable responses are limited to 408, 425, 429, and selected
5xx statuses. Requests time out after 10 seconds by default. Error response
fields with credential-like keys are redacted.

Configured and discovered contract versions must both equal `v1`; incompatible
versions fail startup. Successful tool results report both connector and API
contract versions.

## Development and conformance

```sh
npm test
npm run lint
npm run smoke
```

Tests cover the central API-to-MCP mapping, idempotency, durable statuses,
clarification, safe cancellation, auth/revocation failures, redaction,
default-deny behavior, version rejection, and both transport lifecycles. HTTP
tests use a narrow service-boundary fixture, not a database fake. The central
Handrail discovery endpoint remains the production contract source:

```text
GET /api/assistant-change-bridge/v1/discovery
```

## Release identity

[`RELEASE.json`](./RELEASE.json) records the exact candidate pins. Build the
immutable tarball and checksum with:

```sh
npm run release:artifact
```

The approved release workflow must publish and tag that exact candidate before
consumers use `@handrail/mcp@0.1.0` or
`github:c0x65o/handrail-mcp#v0.1.0`. Never pin a moving branch.
