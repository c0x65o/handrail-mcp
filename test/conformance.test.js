import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createConnectorServer } from "../src/server.js";
import { TOOL_NAMES } from "../src/schemas.js";
import { API_CONTRACT_VERSION } from "../src/version.js";
import { connectInMemory, discovery, enabledConfig, requestRecord } from "./helpers.js";

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function send(res, payload, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function canonicalFixtureEndpoint() {
  const calls = [];
  const request = requestRecord({
    status: "needs_clarification",
    terminal: false,
    linked_work_request: null,
    linked_pm_record: null,
    clarification_history: [{ kind: "question", question: "Please provide a bounded implementation description" }],
  });
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${enabledConfig.token}`);
    assert.equal(req.headers["x-handrail-principal-issuer"], enabledConfig.issuer);
    assert.equal(req.headers["x-handrail-principal-subject"], enabledConfig.subject);
    assert.equal(req.headers["x-handrail-api-contract-version"], API_CONTRACT_VERSION);
    const url = new URL(req.url, "http://fixture");
    calls.push([req.method, url.pathname, req.headers["idempotency-key"] || null]);
    if (req.method === "GET" && url.pathname.endsWith("/discovery")) return send(res, discovery);
    if (req.method === "POST" && url.pathname.endsWith("/requests")) {
      const input = await body(req);
      assert.equal(input.issuer, undefined, "identity must remain server-bound headers, not assistant input");
      assert.equal(req.headers["idempotency-key"], input.idempotency_key);
      return send(res, { request: { ...request, idempotency_key: input.idempotency_key }, replayed: calls.filter(([, path]) => path.endsWith("/requests")).length > 1 }, 201);
    }
    if (req.method === "GET" && url.pathname.endsWith(`/requests/${request.id}`)) return send(res, request);
    if (req.method === "GET" && url.pathname.endsWith(`/requests/${request.id}/release-status`)) {
      return send(res, {
        contract_version: API_CONTRACT_VERSION,
        bridge_request_id: request.id,
        linked_work_request: request.linked_work_request,
        release_tracking: {
          comparison_basis: "full_commit_sha",
          auto_commit: { commits: [{ commit_sha: "abcdef1234567890", version: "1.2.3" }] },
          environments: [{ environment: "production", deployment_state: "not_deployed", contains_change: false }],
        },
      });
    }
    if (req.method === "POST" && url.pathname.endsWith(`/requests/${request.id}/dismiss`)) {
      return send(res, {
        contract_version: API_CONTRACT_VERSION,
        request_id: request.id,
        dismissed_at: "2026-08-13T20:00:00.000Z",
        underlying_request_preserved: true,
      });
    }
    if (req.method === "POST" && url.pathname.endsWith(`/requests/${request.id}/clarifications`)) {
      const input = await body(req);
      return send(res, {
        ...request,
        description: input.description,
        status: "needs_attention",
        terminal: false,
        clarification_history: [...request.clarification_history, { kind: "response", response: input.response }],
        linked_work_request: { id: "work-request-001" },
      });
    }
    if (req.method === "POST" && url.pathname.endsWith(`/requests/${request.id}/cancel`)) {
      return send(res, { ...request, status: "cancelled", terminal: true, cancellation_reason: (await body(req)).reason });
    }
    if (req.method === "GET" && url.pathname.endsWith("/resources/knowledge-base/bridge-contract")) {
      return send(res, { contract_version: API_CONTRACT_VERSION, content: "Authoritative central contract body" });
    }
    if (req.method === "POST" && url.pathname.endsWith("/prompts/submit-change")) {
      const input = await body(req);
      return send(res, {
        contract_version: API_CONTRACT_VERSION,
        messages: [{ role: "user", content: { type: "text", text: `Submit ${input.arguments.goal} through Handrail.` } }],
      });
    }
    send(res, { error: "not found" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    calls,
    baseUrl: `http://127.0.0.1:${server.address().port}/api/assistant-change-bridge/v1`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("one canonical v1 HTTP fixture conforms across discovery, submit, lookup, clarification, cancellation, resources, and prompts", async () => {
  const fixture = await canonicalFixtureEndpoint();
  const connector = await createConnectorServer({ config: { ...enabledConfig, apiUrl: fixture.baseUrl } });
  const connected = await connectInMemory(connector.server);
  try {
    const submitArgs = {
      idempotency_key: "conversation-77:turn-4",
      external_conversation_id: "conversation-77",
      requested_delivery_ceiling: "work_request",
      title: "Add family dashboard",
    };
    const first = await connected.client.callTool({ name: TOOL_NAMES.submit, arguments: submitArgs });
    assert.equal(JSON.parse(first.content[0].text).request.status, "needs_clarification");
    const replay = await connected.client.callTool({ name: TOOL_NAMES.submit, arguments: submitArgs });
    assert.equal(JSON.parse(replay.content[0].text).replayed, true);
    assert.equal(fixture.calls.filter(([, path]) => path.endsWith("/requests")).length, 2);

    const lookup = await connected.client.callTool({ name: TOOL_NAMES.lookup, arguments: { request_id: "bridge-request-001" } });
    assert.equal(JSON.parse(lookup.content[0].text).status, "needs_clarification");
    const releaseStatus = await connected.client.callTool({ name: TOOL_NAMES.releaseStatus, arguments: { request_id: "bridge-request-001" } });
    const release = JSON.parse(releaseStatus.content[0].text).release_tracking;
    assert.equal(release.auto_commit.commits[0].commit_sha, "abcdef1234567890");
    assert.equal(release.auto_commit.commits[0].version, "1.2.3");
    assert.equal(release.environments[0].deployment_state, "not_deployed");
    const dismissed = await connected.client.callTool({
      name: TOOL_NAMES.dismiss,
      arguments: { request_id: "bridge-request-001" },
    });
    assert.equal(JSON.parse(dismissed.content[0].text).underlying_request_preserved, true);
    const clarification = await connected.client.callTool({
      name: TOOL_NAMES.clarify,
      arguments: { request_id: "bridge-request-001", response: "Keep it bounded", description: "Add the approved dashboard change" },
    });
    assert.equal(JSON.parse(clarification.content[0].text).status, "needs_attention");
    const cancellation = await connected.client.callTool({
      name: TOOL_NAMES.cancel,
      arguments: { request_id: "bridge-request-001", reason: "Conversation withdrawn" },
    });
    assert.equal(JSON.parse(cancellation.content[0].text).status, "cancelled");

    const resource = await connected.client.readResource({ uri: discovery.resources[0].uri });
    assert.equal(resource.contents[0].text, "Authoritative central contract body");
    const prompt = await connected.client.getPrompt({ name: discovery.prompts[0].name, arguments: { goal: "the change" } });
    assert.equal(prompt.messages[0].content.text, "Submit the change through Handrail.");
  } finally {
    await connected.close();
    await fixture.close();
  }
});
