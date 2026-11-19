import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createConnectorServer } from "../src/server.js";
import { startStreamableHttp } from "../src/transports.js";
import { FEEDBACK_TOOL_NAMES as names } from "../src/feedback-schemas.js";
import { connectInMemory } from "./helpers.js";

// Bounded mock HTTP boundary derived from Handrail routes/services at
// 502e5bc8051ef78932b7ee423db2dd079c88d25c. Real MCP admission, Zod schemas,
// scoped clients, fetch and response handling. Auth, database transactions,
// assessment scheduling and email custody are SIMULATED, not integration proof.
async function fixture(t) {
  const state = {
    calls: [], status: "needs_clarification", archived: false, dismissed: false,
    question: { id: "question-7", options: ["Current", "All"], question: "Which accounts?", response_allowed: true },
    answer: null, continuations: 0, subscriptions: new Set(),
    discoveryError: null, routeError: null, mismatch: null, drop: false, malformed: false,
    clarificationAllowed: true, notificationsAvailable: true,
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const bug = url.pathname.startsWith("/api/mobile-bug-reports");
    const session = req.headers[bug ? "x-handrail-application-session-token" : "x-handrail-application-session"];
    const discovery = /\/(policy|discovery)$/.test(url.pathname);
    state.calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: req.method, body, session, headers: req.headers });
    const send = (value, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    const fail = (code, status = 403) => send({ code, error: "Simulated canonical denial" }, status);
    if (session !== "known-user-session") return fail("known_user_session_invalid", 401);
    assert.equal(req.headers.authorization, bug ? "Bearer fixture-bug-token" : "Bearer fixture-enhancement-token");
    if (!bug) assert.equal(req.headers["x-handrail-api-contract-version"], "v1");
    if (discovery && state.discoveryError) return fail(state.discoveryError, 401);
    if (!discovery && state.routeError) return fail(state.routeError.code, state.routeError.status);
    if (discovery) {
      const notifications = { available: state.notificationsAvailable, recipient_hint: "u***@example.test", lifecycles: ["fixed"] };
      return send(bug ? {
        schema_version: 1, project_id: state.mismatch === "tenant" ? "another-project" : "project-1",
        environment: state.mismatch === "environment" ? "production" : "staging",
        reporter: { identity_verified: state.mismatch !== "identity" }, reporter_notifications: notifications,
      } : {
        contract_version: "v1",
        capability: { id: "capability-1", project_id: state.mismatch === "tenant" ? "another-project" : "project-1", service_env_id: state.mismatch === "environment" ? "another-runtime" : "service-env-1", environment: "staging" },
        principal: { authenticated: true, authentication_method: state.mismatch === "identity" ? "token_only" : "known_users_direct_session" },
        enhancement_reporting: { enabled: true, workflow: { clarification_response: state.clarificationAllowed } },
        reporter_notifications: notifications,
      });
    }
    const requestId = bug ? "bug-1" : "enhancement-1";
    const prefix = bug ? "/api/mobile-bug-reports/bugs/" : "/api/enhancement-reporting/v1/requests/";
    if (!url.pathname.startsWith(`${prefix}${requestId}`)) return fail(bug ? "bug_history_not_found" : "enhancement_request_not_found", 404);
    const suffix = url.pathname.slice(`${prefix}${requestId}`.length);
    if (req.method === "GET" && suffix === "") return send(bug ? { bug: { id: requestId, archived: state.archived } } : {
      contract_version: "v1", id: requestId, status: state.status,
      information_request: state.status === "needs_clarification" ? state.question : null, dismissed: state.dismissed,
    });
    if (req.method === "POST" && suffix === "/clarifications" && !bug) {
      assert.deepEqual(Object.keys(body).sort(), ["answer", "information_request_id"]);
      assert.equal(req.headers["idempotency-key"], undefined);
      const exact = JSON.stringify({ ...body, answer: body.answer.trim() });
      if (state.answer && state.answer !== exact) return fail("enhancement_clarification_conflict", 409);
      const replayed = state.answer === exact;
      if (!replayed && (state.status !== "needs_clarification" || state.archived
        || body.information_request_id !== state.question.id)) {
        return fail("enhancement_clarification_stale", 409);
      }
      if (!replayed) { state.answer = exact; state.continuations++; state.status = "triaging"; }
      if (state.drop) { state.drop = false; req.socket.destroy(); return; }
      return send({ contract_version: "v1", answered: true, replayed, assessment_id: "continuation-8", assessment_status: "blocked",
        warning: { code: "enhancement_assessment_start_failed", message: "The answer was saved, but its assessment needs native recovery. Do not resubmit or create replacement work." }, implementation_authority: false, deployment_authority: false });
    }
    if (req.method === "POST" && suffix === "/subscription") {
      assert.deepEqual(body, bug ? { project_id: "project-1", environment: "staging", reporter_notification: consent }
        : { reporter_notification: consent });
      const created = !state.subscriptions.has(requestId);
      state.subscriptions.add(requestId);
      if (state.drop) { state.drop = false; req.socket.destroy(); return; }
      if (state.malformed) { state.malformed = false; res.writeHead(201); res.end("truncated{"); return; }
      return send({ ...(bug ? {} : { contract_version: "v1" }), notification_subscription: {
        active: true, created, recipient_hint: "u***@example.test", subscribed_at: "2026-10-02T00:00:00.000Z",
      } }, 201);
    }
    if (req.method === "POST" && suffix === "/cancel") { state.status = "cancelled"; return send({ contract_version: "v1", id: requestId, status: state.status }); }
    if (suffix === "/dismiss" && !bug) {
      state.dismissed = req.method === "POST";
      return send({ contract_version: "v1", request_id: requestId, dismissed: state.dismissed, underlying_request_preserved: true });
    }
    if (suffix === "/archive" && bug) {
      assert.deepEqual(Object.fromEntries(url.searchParams), { project_id: "project-1", environment: "staging" });
      state.archived = req.method === "PUT";
      return send({ bug_id: requestId, archived: state.archived, underlying_bug_preserved: true });
    }
    return fail("unexpected_fixture_route", 500);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const feedbackConfig = {
    enabled: true, sessionToken: "known-user-session",
    bug: { enabled: true, apiBaseUrl: `${origin}/api`, projectId: "project-1", environment: "staging", serviceEnvId: "service-env-1", reportToken: "fixture-bug-token", transport: "server" },
    enhancement: { enabled: true, apiUrl: `${origin}/api/enhancement-reporting/v1`, projectId: "project-1", capabilityId: "capability-1", serviceEnvId: "service-env-1", token: "fixture-enhancement-token", contractVersion: "v1" },
  };
  const connector = await createConnectorServer({ profile: "extended", config: { enabled: false }, feedbackConfig, env: {} });
  const connected = await connectInMemory(connector.server);
  t.after(() => connected.close());
  const call = async (name, args) => {
    const response = await connected.client.callTool({ name, arguments: args });
    let payload;
    try { payload = JSON.parse(response.content[0].text); }
    catch { assert.equal(response.isError, true); payload = { error: response.content[0].text }; }
    return { ...payload, isError: response.isError === true };
  };
  const answer = async () => {
    const current = await call(names.enhancementLookup, { request_id: "enhancement-1" });
    return { request_id: current.id, information_request_id: current.information_request.id, answer: "Only the current household's accounts." };
  };
  return { state, connected, call, answer, feedbackConfig };
}
const consent = { notify_on_resolution: true, consent_version: "v1" };
const subscriptionCases = [[names.bugSubscribe, "bug-1"], [names.enhancementSubscribe, "enhancement-1"]];

test("current canonical question identity flows through MCP; exact duplicate and conflict retain original identity", async t => {
  const f = await fixture(t);
  const input = await f.answer();
  const first = await f.call(names.enhancementClarify, input);
  assert.equal(first.answered, true);
  assert.equal(first.replayed, false);
  assert.equal(first.implementation_authority, false);
  assert.equal(first.deployment_authority, false);
  assert.equal(first.warning.code, "enhancement_assessment_start_failed");
  assert.equal((await f.call(names.enhancementClarify, input)).replayed, true);
  assert.equal((await f.call(names.enhancementClarify, { ...input, answer: "All tenants" })).code, "enhancement_clarification_conflict");
  await f.call(names.enhancementCancel, { request_id: input.request_id });
  f.state.archived = true;
  // Canonical prior-receipt replay precedes the new-answer lifecycle check.
  assert.equal((await f.call(names.enhancementClarify, input)).replayed, true);
  assert.equal(f.state.continuations, 1);
});

test("strict new schemas reject missing/blank/stale-shaped input, consent inference and authority fields before HTTP", async t => {
  const f = await fixture(t);
  const args = await f.answer();
  const tools = (await f.connected.client.listTools()).tools;
  assert.equal(tools.find(x => x.name === names.enhancementClarify).annotations.idempotentHint, true);
  const before = f.state.calls.length;
  for (const input of [{ request_id: args.request_id, information_request_id: args.information_request_id }, { ...args, assessment_version: 0 }, { ...args, assessment_version: 1.5 }, { ...args, assessment_id: " " }, { ...args, answer: " " }, { ...args, answer: "a".repeat(4001) }, { request_id: args.request_id, answer: "answer" }, { ...args, run_codex: true }]) {
    assert.equal((await f.call(names.enhancementClarify, input)).isError, true);
  }
  for (const [name, request_id] of subscriptionCases) {
    for (const extra of [{}, { reporter_notification: { notify_on_resolution: false } }, { reporter_notification: { ...consent, email: "other@example.test" } }, { reporter_notification: consent, subject: "another-user" }]) {
      assert.equal((await f.call(name, { request_id, ...extra })).isError, true);
    }
  }
  assert.equal(f.state.calls.length, before);
});

for (const scenario of ["stale-id", "cancelled", "archived", "changed-scope"]) {
  test(`clarification rejects ${scenario} after current lookup`, async t => {
    const f = await fixture(t);
    const input = await f.answer();
    if (scenario === "stale-id") f.state.question.id = "new-question";
    if (scenario === "cancelled") await f.call(names.enhancementCancel, { request_id: input.request_id, reason: "User cancelled" });
    if (scenario === "archived") f.state.archived = true; // Native archive; reporter dismiss is only history visibility.
    if (scenario === "changed-scope") f.state.routeError = { code: "enhancement_clarification_source_changed", status: 409 };
    const result = await f.call(names.enhancementClarify, input);
    assert.equal(result.isError, true);
    assert.equal(result.code, scenario === "changed-scope" ? "enhancement_clarification_source_changed" : "enhancement_clarification_stale");
    assert.equal(f.state.continuations, 0);
  });
}

test("both subscriptions preserve canonical response and dedup; history archive/restore stays independent", async t => {
  const f = await fixture(t);
  for (const [name, request_id] of subscriptionCases) {
    const result = await f.call(name, { request_id, reporter_notification: consent });
    assert.deepEqual(result.notification_subscription, { active: true, created: true, recipient_hint: "u***@example.test", subscribed_at: "2026-10-02T00:00:00.000Z" });
    assert.equal((await f.call(name, { request_id, reporter_notification: consent })).notification_subscription.created, false);
    assert.equal(result.background_authorization, undefined);
  }
  assert.equal((await f.call(names.bugArchive, { request_id: "bug-1" })).archived, true);
  assert.equal((await f.call(names.bugSubscribe, { request_id: "bug-1", reporter_notification: consent })).notification_subscription.created, false);
  assert.equal((await f.call(names.bugRestore, { request_id: "bug-1" })).archived, false);
  assert.equal((await f.call(names.enhancementArchive, { request_id: "enhancement-1" })).dismissed, true);
  // Canonical subscription ownership does not reject cancellation or history dismissal.
  await f.call(names.enhancementCancel, { request_id: "enhancement-1" });
  assert.equal((await f.call(names.enhancementSubscribe, { request_id: "enhancement-1", reporter_notification: consent })).notification_subscription.active, true);
  assert.equal(f.state.subscriptions.size, 2);
});

for (const mismatch of ["tenant", "environment", "identity"]) {
  test(`fresh discovery blocks ${mismatch} mismatch after catalog admission`, async t => {
    const f = await fixture(t);
    const args = await f.answer();
    const before = f.state.calls.filter(x => x.method === "POST").length;
    f.state.mismatch = mismatch;
    for (const [name, request_id] of subscriptionCases) assert.equal((await f.call(name, { request_id, reporter_notification: consent })).isError, true);
    assert.equal((await f.call(names.enhancementClarify, args)).isError, true);
    assert.equal(f.state.calls.filter(x => x.method === "POST").length, before);
    const discovery = await f.call(names.discover, {});
    assert.equal(discovery.reporters.bug.ready, false);
    assert.equal(discovery.reporters.enhancement.ready, false);
  });
}

for (const code of ["known_user_session_invalid", "enhancement_reporting_credential_revoked", "enhancement_reporting_disabled"]) {
  test(`revocation on the next discovery blocks writes: ${code}`, async t => {
    const f = await fixture(t);
    const args = await f.answer();
    f.state.discoveryError = code;
    assert.equal((await f.call(names.enhancementClarify, args)).isError, true);
    for (const [name, request_id] of subscriptionCases) assert.equal((await f.call(name, { request_id, reporter_notification: consent })).isError, true);
    assert.equal(f.state.calls.some(x => x.method === "POST"), false);
  });
}

test("upstream denials after successful discovery remain errors without retries or identity substitution", async t => {
  const f = await fixture(t);
  const args = await f.answer();
  for (const [code, status] of [["enhancement_clarification_source_changed", 409], ["enhancement_request_not_found", 404], ["known_user_session_invalid", 401], ["enhancement_reporting_scope_denied", 403], ["feedback_notification_identity_email_required", 403]]) {
    f.state.routeError = { code, status };
    const before = f.state.calls.filter(x => x.method === "POST").length;
    const result = await f.call(names.enhancementClarify, args);
    assert.equal(result.code, code);
    assert.equal(result.status, status);
    assert.equal(f.state.calls.filter(x => x.method === "POST").length, before + 1);
    for (const [name, request_id] of subscriptionCases) assert.equal((await f.call(name, { request_id, reporter_notification: consent })).code, code);
  }
});

test("uncertain committed answer and subscriptions are single-attempt; exact retry reconciles the original identity", async t => {
  const f = await fixture(t);
  const args = await f.answer();
  f.state.drop = true;
  const result = await f.call(names.enhancementClarify, args);
  assert.equal(result.code, "feedback_transport_network_error");
  assert.equal(f.state.continuations, 1);
  assert.equal(f.state.calls.filter(x => x.path.endsWith("/clarifications")).length, 1);
  assert.equal((await f.call(names.enhancementClarify, args)).replayed, true);
  for (const [name, request_id] of subscriptionCases) {
    f.state.drop = true;
    assert.equal((await f.call(name, { request_id, reporter_notification: consent })).code, "feedback_transport_network_error");
    assert.equal((await f.call(name, { request_id, reporter_notification: consent })).notification_subscription.created, false);
    f.state.malformed = true;
    assert.equal((await f.call(name, { request_id, reporter_notification: consent })).code, "feedback_transport_invalid_response");
  }
  assert.equal(f.state.subscriptions.size, 2);
  assert.equal(f.state.continuations, 1);
});

test("discovery permissions gate new operations and recheck on invocation", async t => {
  const f = await fixture(t);
  const args = await f.answer();
  f.state.clarificationAllowed = false;
  f.state.notificationsAvailable = false;
  assert.equal((await f.call(names.enhancementClarify, args)).isError, true);
  for (const [name, request_id] of subscriptionCases) assert.equal((await f.call(name, { request_id, reporter_notification: consent })).isError, true);
  const connector = await createConnectorServer({ profile: "extended", config: { enabled: false }, feedbackConfig: f.feedbackConfig, env: {} });
  const connected = await connectInMemory(connector.server);
  t.after(() => connected.close());
  const catalog = (await connected.client.listTools()).tools.map(x => x.name);
  assert.ok(catalog.includes(names.enhancementLookup));
  for (const name of [names.enhancementClarify, names.enhancementSubscribe, names.bugSubscribe]) assert.ok(!catalog.includes(name));
});

test("Streamable HTTP uses only the current request session, never bootstrap feedback session", async t => {
  const f = await fixture(t);
  const running = await startStreamableHttp({ profile: "extended", port: 0, config: { enabled: false }, feedbackConfig: f.feedbackConfig, env: {} });
  t.after(() => running.close());
  for (const session of ["known-user-session", "other-session", null]) {
    const client = new Client({ name: "feedback-session-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.address.port}/mcp`), {
      requestInit: { headers: session ? { "x-handrail-application-session": session } : {} },
    });
    await client.connect(transport);
    t.after(() => client.close());
    const catalog = (await client.listTools()).tools.map(x => x.name);
    assert.equal(catalog.includes(names.bugSubscribe), session === "known-user-session");
    assert.equal(catalog.includes(names.enhancementClarify), session === "known-user-session");
  }
});
