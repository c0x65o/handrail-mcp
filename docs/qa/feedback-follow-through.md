# Canonical feedback connector handoff

The uncommitted connector candidate adds `handrail_enhancement_reporter_v1_clarify`,
`handrail_enhancement_reporter_v1_subscribe`, and
`handrail_bug_reporter_v1_subscribe` to the existing feedback catalog and execution
path. It refreshes canonical discovery before every call and binds Streamable
HTTP feedback to the incoming request session. New schemas reject caller-selected
identity, email and implementation controls. Public types are exported through
`@handrail/mcp/feedback`.

[Machine-readable handoff](feedback-follow-through.json) contains exact schemas,
HTTP methods/bodies/responses, inspected source hashes, discovery prerequisites,
retry semantics, SDK binding steps, simulation boundaries and preserved QA holds.

## Verification

- `npm test`: 48 passed, including 18 new follow-through tests using real MCP
  admission, schema validation, clients, loopback HTTP and response handling.
- `npm run lint`, `npm run smoke`, and `git diff --check`: passed. Smoke runs the
  CLI and `npm pack --dry-run`; it does not install or publish an archive.
- TypeScript 5.9.3: strict NodeNext compilation of `test/types/feedback.ts` passed,
  both against the checkout and the candidate in the installed consumer tree.
  The compiler came from the existing read-only Agent SDK installation; no new
  dependency was added. Command:
  `node <typescript>/lib/tsc.js --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 test/types/feedback.ts`.

The bounded HTTP fixture simulates canonical authorization, ownership, database
transactions, assessment scheduling and subscription persistence. It covers
current-assessment answers, duplicate replay, conflict/staleness, cancellation,
native archive versus reporter history dismissal, revoked sessions/capabilities,
source/project/environment denials, uncertain applied writes, strict explicit
consent, and existing bug archive/restore. It proves connector behavior at those
boundaries, not live canonical enforcement or provider delivery. No real report,
notification, database/queue mutation, deployment or mobile build was performed.

The initial full suite exposed an existing tag-pin expectation inconsistent with
`RELEASE.json` and the supplied dependency policy. The package check and public
installation guidance now use the HTTPS/full-SHA policy. No version was bumped.

## Installation and publication boundary

The public base is version **0.2.1**, SHA
**eb879d767d05c7c2e15748f6fe7838294b980d82**:
`git+https://github.com/c0x65o/handrail-mcp.git#eb879d767d05c7c2e15748f6fe7838294b980d82`.
A disposable consumer installed that revision normally, then passed `npm ci` and
normal `@handrail/mcp` import. The retained JSON records its matching manifest,
HTTPS resolved lock entry, version and lock hash. npm initially normalized the
resolved URL to SSH; the task-local lock entry was normalized back to the same
public HTTPS/full SHA, and `npm ci` retained it. Application and SDK pins were
untouched.

After that install, the candidate's `src` and `package.json` were copied into the
installed package directory. Normal package-name imports exposed all 16 tools
and executed the three new operations against mock fetch. The retained
[consumer check](feedback-consumer-check.mjs) reproduces this check when copied
into the disposable consumer directory and run there; copy the type fixture
there too for installed-package compilation. No build step is needed for this
JavaScript package.

That overlay is **not** installation of a published candidate. Handrail's
post-agent pipeline must bump, commit and push the whole checkout, return the
resulting full HTTPS SHA/version, and the owning workflow must repeat normal
installation from that revision before updating Mills. This worker left the
source changes uncommitted, as instructed.

## Remaining Mills work

Subscription success records explicit email consent and returns only
`{ active, created, recipient_hint, subscribed_at }`. Handrail owns fixed-lifecycle
email delivery. It grants no background credential or conversation callback.
This is an exact missing capability if Mills has no independently authorized
fresh-session path for unattended observations; saving raw sessions/cookies is
not a solution.

Avery must bind the existing SDK effect adapter and observer to Mills' existing
assistance/effect stores, current authority checks, exact environment and original
conversation. Use current lookup assessment IDs/versions for real user answers;
never map them to developer clarification or staff approval. Preserve canonical
receipts and uncertain intent identities. Use the existing SDK readiness and
notification deduplication path for one canonical ready return, retaining reminder
behavior. Independent staging QA and subsequent application delivery remain with
Avery. This connector candidate alone does not establish Mills readiness.
