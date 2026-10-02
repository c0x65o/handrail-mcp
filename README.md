# handrail-mcp

`@handrail/mcp` is the sole project-side MCP connector for Handrail. It exposes
the versioned central Handrail REST API through standard MCP tools, resources,
prompts, and transports. The connector is deliberately stateless: Handrail
owns authentication, authorization, policy, durable request/status/audit data,
historical PM audit data and the Work Request lifecycle, Knowledge Base content,
and compatibility.

Current connector version: `0.2.3`. Developer Change API contract: `v1`.
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
npx --no-install handrail-mcp --transport stdio
npx --no-install handrail-mcp --transport http --host 127.0.0.1 --port 3000 --path /mcp
handrail-mcp --version
```

The supported standard transports are stdio and stateless Streamable HTTP.
HTTP binds to loopback by default; authentication and network exposure remain
the host deployment's responsibility.

Reporter readiness decides which customer feedback tools are registered:

- `handrail_feedback_v2_discover`
- `handrail_bug_reporter_v1_submit`, `list`, `lookup`, `archive`, `restore`, `subscribe`
- `handrail_enhancement_reporter_v1_submit`, `list`, `lookup`,
  `release_status`, `archive`, `restore`, `cancel`, `clarify`, `subscribe`

Bug tools call the canonical Bug Reporting API, so accepted reports create or
deduplicate canonical `pm_bugs` and then enter existing classification,
verification, repair, and delivery policy. Enhancement tools call the
canonical Enhancement Reporting API, so accepted requests create
`pm_enhancements` plus `pm_enhancement_intake_submissions`, then enter the
read-only assessment and risk-gated implementation policy. Neither path writes
`assistant_bridge_requests`.
Bug submit requires a stable `event_id`; enhancement submit requires a stable
`idempotency_key`. Reuse either identity only for an exact retry.

Feedback discovery is refreshed before each call, including long-lived stdio
connections. Clarify is advertised only when canonical discovery reports
`enhancement_reporting.workflow.clarification_response: true`; subscribe requires
`reporter_notifications.available: true` (verified Known User with a configured
email). These flags are checked again at invocation. The canonical route remains
the authority for current ownership, source revision, credential and request state.

`handrail_enhancement_reporter_v1_clarify` accepts
`{ request_id, assessment_id, assessment_version, answer }`. Read the current
`clarification` from enhancement lookup and require `response_allowed: true`.
The version is a positive safe integer and the nonblank answer is at most 4,000
characters. Preserve the request/assessment/version/answer for an exact retry.
Conflict or stale errors require a fresh lookup and user input for the current
question; never replace work or reuse an answer for changed scope automatically.
An `answered: true` response can include a warning that the saved answer's
assessment needs native recovery. It does not approve implementation or release.

Both `subscribe` tools require
`{ request_id, reporter_notification: { notify_on_resolution: true, consent_version?: "v1" } }`.
Consent must come from the user; there is no default opt-in. The version is an
optional nonblank string up to 40 characters (upstream defaults to `v1`). The
recipient comes from the current verified session, never a tool email argument.
The result contains `notification_subscription: { active, created, recipient_hint,
subscribed_at }`; enhancement also returns `contract_version: "v1"`. An exact
active subscription returns `created: false`. This records email consent; it is
neither a delivered notification nor proof that the work is ready. Handrail owns
the canonical fixed-lifecycle email dispatch and its deduplication.

Subscriptions grant no background lookup credential, refresh token, webhook or
conversation callback. A host must supply fresh authorized identity for SDK
observations without saving raw sessions/cookies. Agent SDK owns observation
polling and conversation notification deduplication; MCP does not add a scheduler.
The integration handoff in `docs/qa/feedback-follow-through.json` records the
remaining Mills binding and verification dependencies. Public input/response
types and the catalog are available from `@handrail/mcp/feedback`.

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

For the developer compatibility client, only discovery, principal-scoped list, lookup, release status, idempotent
submit, idempotent dismissal, and safe cancellation receive bounded retries
(`2` by default). Clarification is non-idempotent and is not
retried; binary attachment downloads are also single-attempt. Retryable responses are limited to 408, 425, 429, and selected
5xx statuses. Requests time out after 10 seconds by default. Error response
fields with credential-like keys are redacted.

Feedback HTTP calls are single-attempt. A timeout, dropped response, or unreadable
success response leaves the outcome uncertain. Preserve the original canonical
ID and exact input for reconciliation; do not generate replacement intent IDs.
Enhancement clarification supports canonical exact replay despite having no
caller-provided idempotency key. Subscription deduplication is canonical by
project/report kind/report ID/verified email while the subscription is active.

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

Internal consumers install from the canonical public HTTPS Git repository with
a full committed SHA and matching package-manager lockfile:

```text
git+https://github.com/c0x65o/handrail-mcp.git#<full-40-character-commit-SHA>
```

Resolve the latest committed revision for new installations; preserve the frozen
revision for controlled upgrades. Do not use branch, tag, registry, tarball,
file or workspace dependencies for Handrail packages. This JavaScript package
requires no separate compilation or packaging step. The queued-work pipeline
owns the version bump, whole-checkout commit and push; an uncommitted candidate
has no published SHA. Consumer pins must use the resulting published revision,
not this candidate's base revision. npm publication is absent.

#### Original-conversation follow-up

Canonical discovery may advertise `reporter_observations` v1. The matching
`handrail_{bug,enhancement}_reporter_v1_follow_up` tool requires an explicit user
request; the host supplies the stable observation ID, original conversation,
tenant/principal/project/runtime/environment binding and expiry. The matching
`stop_follow_up` cancels only the return. This is independent of email consent.
Existing session-authenticated reporter tools retain their original checks.

A background worker imports `createFeedbackObservationClient` from
`@handrail/mcp/feedback` with its existing exact-runtime server configuration.
It calls `read(savedGrant)` or `cancel(savedGrant)` without a user session. The
client exposes no report mutation methods or callback URL parameter. Handrail
rechecks current credentials, rotation/revocation, membership/source revision,
expiry and binding, and returns only canonical lifecycle evidence. The Agent
SDK owns the watch lifecycle; the application's existing conversation outbox
owns durable rendering and duplicate acknowledgement recovery.

Deploy Handrail's extension and use native credential issuance/rotation to admit
the new exact enhancement API routes before adopting this source. Discovery
hides these tools for an old credential; runtime reconciliation never broadens
its allowlist silently. Publish through canonical Git operations, then install
from a public HTTPS full40 SHA with a matching lockfile. Source-fixture checks
are not evidence of installed or deployed support.
