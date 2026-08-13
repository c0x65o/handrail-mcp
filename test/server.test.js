import assert from "node:assert/strict";
import test from "node:test";

import { createConnectorServer } from "../src/server.js";
import { TOOL_NAMES } from "../src/schemas.js";
import { API_CONTRACT_VERSION, CONNECTOR_VERSION } from "../src/version.js";
import { connectInMemory, discovery, requestRecord } from "./helpers.js";

function fakeClient({ enabled = true } = {}) {
  const calls = [];
  const client = {
    calls,
    getConfig: () => ({ enabled, disabled_reason: enabled ? null : "disabled" }),
    discover: async () => discovery,
    submit: async (args) => {
      calls.push(["submit", args]);
      return { request: requestRecord(), replayed: false };
    },
    list: async (args) => {
      calls.push(["list", args]);
      return { contract_version: API_CONTRACT_VERSION, requests: [requestRecord()], pagination: { limit: 20, offset: 0, total: 1, has_more: false } };
    },
    lookup: async (args) => {
      calls.push(["lookup", args]);
      return requestRecord({ status: "running", terminal: false });
    },
    releaseStatus: async (args) => {
      calls.push(["releaseStatus", args]);
      return {
        contract_version: API_CONTRACT_VERSION,
        bridge_request_id: args.request_id,
        release_tracking: { comparison_basis: "full_commit_sha" },
      };
    },
    dismiss: async (args) => {
      calls.push(["dismiss", args]);
      return {
        contract_version: API_CONTRACT_VERSION,
        request_id: args.request_id,
        dismissed_at: "2026-08-13T20:00:00.000Z",
        underlying_request_preserved: true,
      };
    },
    clarify: async (args) => {
      calls.push(["clarify", args]);
      return requestRecord({ status: "accepted", terminal: true });
    },
    cancel: async (args) => {
      calls.push(["cancel", args]);
      return requestRecord({ status: "cancelled", terminal: true });
    },
    readResource: async (descriptor) => {
      calls.push(["resource", descriptor]);
      return { contract_version: API_CONTRACT_VERSION, content: "Central KB body" };
    },
    getPrompt: async (descriptor, args) => {
      calls.push(["prompt", descriptor, args]);
      return {
        contract_version: API_CONTRACT_VERSION,
        messages: [{ role: "user", content: { type: "text", text: `Implement ${args.goal}` } }],
      };
    },
  };
  return client;
}

test("disabled/default-deny runtime exposes no tools, resources, or prompts", async () => {
  const connector = await createConnectorServer({ client: fakeClient({ enabled: false }) });
  const connected = await connectInMemory(connector.server);
  assert.deepEqual((await connected.client.listTools()).tools, []);
  assert.deepEqual((await connected.client.listResources()).resources, []);
  assert.deepEqual((await connected.client.listPrompts()).prompts, []);
  await connected.close();
});

test("MCP tools mirror discovery, bind server identity, and report both versions", async () => {
  const client = fakeClient();
  const connector = await createConnectorServer({ client });
  const connected = await connectInMemory(connector.server);
  const tools = (await connected.client.listTools()).tools;
  assert.deepEqual(tools.map((tool) => tool.name), Object.values(TOOL_NAMES));
  assert.ok(tools.every((tool) => !Object.hasOwn(tool.inputSchema.properties, "issuer")));
  assert.ok(tools.every((tool) => !Object.hasOwn(tool.inputSchema.properties, "subject")));

  const discoveryResult = await connected.client.callTool({ name: TOOL_NAMES.discover, arguments: {} });
  const discovered = JSON.parse(discoveryResult.content[0].text);
  assert.equal(discovered.contract_version, API_CONTRACT_VERSION);
  assert.equal(discovered.connector.connector_version, CONNECTOR_VERSION);
  assert.equal(discovered.connector.api_contract_version, API_CONTRACT_VERSION);
  assert.equal(discovered.principal.authenticated, true);
  assert.equal(discovered.principal.access_level, "custom");
  const submitTool = tools.find((tool) => tool.name === TOOL_NAMES.submit);
  assert.deepEqual(submitTool.inputSchema.properties.priority.anyOf[0].enum, [
    "low",
    "medium",
    "high",
    "urgent",
  ]);
  assert.deepEqual(submitTool.inputSchema.properties.requested_delivery_ceiling.enum, [
    "work_request",
    "staging",
    "production",
  ]);
  assert.deepEqual(submitTool.inputSchema.properties.auto_deploy_env.anyOf[0].enum, [
    "staging",
    "production",
  ]);
  assert.match(submitTool.description, /Multiple requests may be pending or running at once/);
  assert.match(submitTool.inputSchema.properties.idempotency_key.description, /new key for each separate request/);
  assert.match(submitTool.inputSchema.properties.external_conversation_id.description, /many simultaneous requests may share it/);
  assert.match(tools.find((tool) => tool.name === TOOL_NAMES.lookup).description, /each request\.id/);

  const submit = {
    idempotency_key: "conversation-1:turn-1",
    external_conversation_id: "conversation-1",
    requested_delivery_ceiling: "work_request",
    title: "Add dashboard",
  };
  await connected.client.callTool({ name: TOOL_NAMES.submit, arguments: submit });
  await connected.client.callTool({ name: TOOL_NAMES.list, arguments: { submission_kind: "enhancement" } });
  await connected.client.callTool({ name: TOOL_NAMES.lookup, arguments: { request_id: "bridge-request-001" } });
  const releaseStatus = await connected.client.callTool({ name: TOOL_NAMES.releaseStatus, arguments: { request_id: "bridge-request-001" } });
  assert.equal(JSON.parse(releaseStatus.content[0].text).release_tracking.comparison_basis, "full_commit_sha");
  const dismissed = await connected.client.callTool({ name: TOOL_NAMES.dismiss, arguments: { request_id: "bridge-request-001" } });
  assert.equal(JSON.parse(dismissed.content[0].text).underlying_request_preserved, true);
  await connected.client.callTool({ name: TOOL_NAMES.clarify, arguments: { request_id: "bridge-request-001", response: "Keep the change bounded" } });
  await connected.client.callTool({ name: TOOL_NAMES.cancel, arguments: { request_id: "bridge-request-001", reason: "Withdrawn" } });
  assert.deepEqual(client.calls.slice(0, 7).map(([name]) => name), ["submit", "list", "lookup", "releaseStatus", "dismiss", "clarify", "cancel"]);
  assert.deepEqual(client.calls[0][1], submit);
  await connected.close();
});

test("resources and prompts are descriptors only; every body is fetched centrally", async () => {
  const client = fakeClient();
  const connector = await createConnectorServer({ client });
  const connected = await connectInMemory(connector.server);
  const resources = (await connected.client.listResources()).resources;
  assert.equal(resources.length, 1);
  assert.equal(resources[0].uri, discovery.resources[0].uri);
  const resource = await connected.client.readResource({ uri: resources[0].uri });
  assert.equal(resource.contents[0].text, "Central KB body");

  const prompts = (await connected.client.listPrompts()).prompts;
  assert.equal(prompts.length, 1);
  const prompt = await connected.client.getPrompt({ name: prompts[0].name, arguments: { goal: "a dashboard" } });
  assert.equal(prompt.messages[0].content.text, "Implement a dashboard");
  assert.deepEqual(client.calls.slice(-2).map(([name]) => name), ["resource", "prompt"]);
  await connected.close();
});

test("discovery operation allowlist removes unadvertised tools", async () => {
  const limited = { ...discovery, operations: ["discover", "lookup"] };
  const connector = await createConnectorServer({ client: fakeClient(), discovery: limited });
  const connected = await connectInMemory(connector.server);
  assert.deepEqual((await connected.client.listTools()).tools.map((tool) => tool.name), [TOOL_NAMES.discover, TOOL_NAMES.lookup]);
  await connected.close();
});
