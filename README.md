# handrail-mcp

`@handrail/mcp` is the sole project-side MCP connector for Handrail. It exposes
the versioned central Handrail REST API through standard MCP tools, resources,
prompts, and transports. The connector is deliberately stateless: Handrail
owns authentication, authorization, policy, durable request/status/audit data,
historical PM audit data and the Work Request lifecycle, Knowledge Base content,
and compatibility.

Current connector version: `0.2.1`. Developer Change API contract: `v1`.
Customer feedback composition contract: `v2`.

## Runtime contract

The connector has independent, server-only feedback transports. It shares the
canonical Handrail feedback APIs and backend policy with the browser reporter
SDKs, but does not install or import either reporter package. Applications can
install MCP, either reporter SDK, or both without creating package coupling.

Bug feedback uses the service-bound `HANDRAIL_BUG_REPORT_*` variables.
Enhancement feedback uses the independent first-class
`HANDRAIL_ENHANCEMENT_REPORTER_*` variables. The connector exposes no mutation
tool when the corresponding configuration, exact binding, session, or
discovery proof is absent.
`handrail_feedback_v2_discover` reports a bounded actionable reason without
returning credentials.

The separate developer Work Request compatibility surface uses these values:

```text
HANDRAIL_ASSISTANT_BRIDGE_ENABLED=true
HANDRAIL_ASSISTANT_BRIDGE_API_URL=https://handrail.example/api/assistant-change-bridge/v1
HANDRAIL_ASSISTANT_BRIDGE_VERSION=v1
HANDRAIL_ASSISTANT_BRIDGE_PROJECT_ID=...
HANDRAIL_ASSISTANT_BRIDGE_CAPABILITY_ID=...
HANDRAIL_ASSISTANT_BRIDGE_TOKEN=...
```

The bearer credential is server-only. Do not put it in repository env files,
browser/mobile configuration, tool arguments, logs, or assistant context.
For Streamable HTTP, the host application forwards its current authenticated
session in `X-Handrail-Application-Session` on each MCP request. The connector
passes that session to Handrail, where the project's Known Users mapping derives
the stable user ID and per-user grant. Identity is never a tool argument, so an
assistant cannot select another user through prompt text. Static issuer/subject
configuration remains a legacy compatibility path for non-Known-Users grants.
Revocation, source-revision changes, and policy changes are enforced centrally
on every call.
Successful discovery explicitly reports `principal.authenticated`, the
authentication method, the canonical Known User `role` (`requester`,
`contributor`, or `maintainer`) when applicable, and the compatible resolved
`access_level` (`default`, `user`,
`full_access`, or `custom`) alongside the effective policy.

## CLI and transports

Node.js 20 or newer is required.

```sh
npx --package github:c0x65o/handrail-mcp handrail-mcp --transport stdio
npx --package github:c0x65o/handrail-mcp handrail-mcp --transport http --host 127.0.0.1 --port 3000 --path /mcp
handrail-mcp --version
```

The supported standard transports are stdio and stateless Streamable HTTP.
HTTP binds to loopback by default; authentication and network exposure remain
the host deployment's responsibility.

Reporter readiness decides which customer feedback tools are registered:

- `handrail_feedback_v2_discover`
- `handrail_bug_reporter_v1_submit`, `list`, `lookup`, `archive`, `restore`
- `handrail_enhancement_reporter_v1_submit`, `list`, `lookup`,
  `release_status`, `archive`, `restore`, `cancel`

Bug tools call the canonical Bug Reporting API, so accepted reports create or
deduplicate canonical `pm_bugs` and then enter existing classification,
verification, repair, and delivery policy. Enhancement tools call the
canonical Enhancement Reporting API, so accepted requests create
`pm_enhancements` plus `pm_enhancement_intake_submissions`, then enter the
read-only assessment and risk-gated implementation policy. Neither path writes
`assistant_bridge_requests`.
Bug submit requires a stable `event_id`; enhancement submit requires a stable
`idempotency_key`. Reuse either identity only for an exact retry.

The separately named developer compatibility tools are:

- `handrail_developer_change_v1_discover`
- `handrail_developer_change_v1_submit`
- `handrail_developer_change_v1_list`
- `handrail_developer_change_v1_lookup`
- `handrail_developer_change_v1_release_status`
- `handrail_developer_change_v1_dismiss`
- `handrail_developer_change_v1_clarify`
- `handrail_developer_change_v1_cancel`

Submission is Work Request-only. The connector does not expose feature/task
intake or a caller-selectable mode. Central policy turns `Pending` into a
durable Pending Work Request and `Automatic` into a Work Request that starts
immediately. Staging is an independent permission: the assistant requests it
only when the requested change calls for deployment.
The delivery ceilings a caller may request are `work_request`, `staging`, and
`production`; policy can always reduce the effective ceiling. Production is a
separate, default-deny permission and never bypasses the canonical Work Request,
required validation, or production deployment gates.
Submission priorities use the canonical `low`, `medium`, `high`, and `urgent`
tiers. After submission, use the returned bridge request ID with `lookup` to
monitor the linked Work Request and its durable execution evidence. Lookup
includes a canonical `release_tracking` projection. The dedicated
`release_status` tool reports the full auto-commit SHA, the version created by
that commit, every recorded deployment of the change (including later manual
deployments), and the current SHA/version on each configured environment
target.
These tools are explicitly not customer feedback intake. Historical enhancement
rows remain readable through legacy IDs, but new enhancements use the reporter
tools and first-class records.

Multiple change requests can be pending or running simultaneously, including
within the same conversation. `external_conversation_id` groups those requests
for traceability; it does not serialize them. Give every distinct user intent a
new stable `idempotency_key`, ideally derived from the conversation ID plus a
durable user-message or intent ID. Reuse that key only when retrying the exact
same submission. Retain every returned `request.id` and call `lookup`
independently for each active request.

Knowledge Base resources and prompt descriptors are also obtained from central
discovery. Their bodies are fetched from same-origin paths beneath the bound
versioned API when invoked; no KB body or prompt implementation is packaged.

## Safety and errors

Only discovery, principal-scoped list, lookup, release status, idempotent
submit, idempotent dismissal, and safe cancellation receive bounded retries
(`2` by default). Clarification is non-idempotent and is not
retried; binary attachment downloads are also single-attempt. Retryable responses are limited to 408, 425, 429, and selected
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

Tests cover the central API-to-MCP mapping, Work Request-only submission,
idempotency, durable statuses, principal-scoped history and attachment downloads,
clarification, safe cancellation, auth/revocation failures, redaction,
default-deny behavior, version rejection, and both transport lifecycles. HTTP
tests use a narrow service-boundary fixture, not a database fake. The central
Handrail discovery endpoint remains the production contract source:

```text
GET /api/assistant-change-bridge/v1/discovery
```

## Release identity

Internal consumers install the latest package directly from the canonical
public Git repository. They do not wait for a Handrail-provided tag, commit, or
archive before integrating. The consumer lockfile records the exact revision
that npm resolved, and Owner Maintenance compares that evidence with the
repository's current package version and Git revision to create controlled
upgrade work. npm publication is currently absent, so compatibility and install
guidance must not claim an npm registry release or require a vendored tarball.
