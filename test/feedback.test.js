import assert from "node:assert/strict";
import test from "node:test";

import { createConnectorServer } from "../src/server.js";
import {
  DEVELOPER_TOOL_NAMES,
  FEEDBACK_TOOL_NAMES,
} from "../src/feedback-schemas.js";
import { connectInMemory, discovery } from "./helpers.js";

function disabledBridge() {
  return { getConfig: () => ({ enabled: false }) };
}

function enabledBridge() {
  return {
    getConfig: () => ({ enabled: true }),
    discover: async () => discovery,
    submit: async () => ({ contract_version: "v1", status: "pending", terminal: false }),
    list: async () => ({ contract_version: "v1", requests: [] }),
    lookup: async () => ({ contract_version: "v1", status: "pending", terminal: false }),
    releaseStatus: async () => ({ contract_version: "v1" }),
    dismiss: async () => ({ contract_version: "v1" }),
    clarify: async () => ({ contract_version: "v1", status: "pending", terminal: false }),
    cancel: async () => ({ contract_version: "v1", status: "cancelled", terminal: true }),
    readResource: async () => ({ content: "legacy" }),
    getPrompt: async () => ({ messages: [] }),
  };
}

function bugModule(calls = [], policy = null) {
  const client = {
    discoverPolicy: async () => policy || ({
      schemaVersion: 1,
      projectId: "project-1",
      environment: "staging",
      identityVerified: true,
    }),
    submit: async (input) => { calls.push(["bug.submit", input]); return { status: "submitted", bugId: "bug-1" }; },
    listBugs: async (input) => { calls.push(["bug.list", input]); return { bugs: [] }; },
    getBug: async (id) => ({ id }),
    archiveBug: async (id) => ({ bug_id: id, archived: true }),
    restoreBug: async (id) => ({ bug_id: id, archived: false }),
  };
  return {
    createRequestScopedBugReporter: (config) => ({
      forRequest(request) {
        assert.equal(config.resolveApplicationSessionToken(request), "session-1");
        return client;
      },
    }),
  };
}

function enhancementModule(calls = [], discovered = null) {
  const client = {
    discover: async () => discovered || ({
      contract_version: "v1",
      capability: { id: "enhancement-1", project_id: "project-1", service_env_id: "service-env-1" },
      principal: { authenticated: true, authentication_method: "known_users_direct_session" },
      enhancement_reporting: { enabled: true },
    }),
    submit: async (input) => { calls.push(["enhancement.submit", input]); return { contract_version: "v1", request: { id: "request-1" } }; },
    list: async (input) => { calls.push(["enhancement.list", input]); return { contract_version: "v1", requests: [] }; },
    lookup: async ({ request_id }) => ({ contract_version: "v1", id: request_id }),
    releaseStatus: async ({ request_id }) => ({ contract_version: "v1", request_id }),
    dismiss: async ({ request_id }) => ({ contract_version: "v1", request_id, dismissed: true }),
    restore: async ({ request_id }) => ({ contract_version: "v1", request_id, dismissed: false }),
    cancel: async ({ request_id }) => ({ contract_version: "v1", id: request_id, status: "cancelled" }),
  };
  return {
    createRequestScopedEnhancementReporter: (config) => ({
      async forRequest(request) {
        assert.equal(config.resolveApplicationSessionToken(request), "session-1");
        return client;
      },
    }),
  };
}

const base = {
  enabled: true,
  sessionToken: "session-1",
  bug: {
    enabled: true,
    apiBaseUrl: "https://handrail.example/api",
    projectId: "project-1",
    environment: "staging",
    reportToken: "bug-secret",
    serviceEnvId: "service-env-1",
    transport: "server",
  },
  enhancement: {
    enabled: true,
    apiUrl: "https://handrail.example/api/enhancement-reporting/v1",
    projectId: "project-1",
    capabilityId: "enhancement-1",
    serviceEnvId: "service-env-1",
    token: "enhancement-secret",
    contractVersion: "v1",
  },
};

async function listed(options) {
  const connector = await createConnectorServer(options);
  const connected = await connectInMemory(connector.server);
  return { connector, connected, tools: (await connected.client.listTools()).tools };
}

test("feedback discovery explains why neither reporter is available", async () => {
  const { connected, tools } = await listed({
    client: disabledBridge(),
    feedbackConfig: { enabled: true, sessionToken: "session-1" },
  });
  assert.deepEqual(tools.map(({ name }) => name), [FEEDBACK_TOOL_NAMES.discover]);
  const result = await connected.client.callTool({ name: FEEDBACK_TOOL_NAMES.discover, arguments: {} });
  const readiness = JSON.parse(result.content[0].text);
  assert.equal(readiness.reporters.bug.reason, "not_configured");
  assert.equal(readiness.reporters.enhancement.reason, "not_configured");
  await connected.close();
});

for (const scenario of ["bug", "enhancement", "both"]) {
  test(`${scenario}-only reporter readiness exposes exactly its canonical tools`, async () => {
    const feedbackConfig = {
      ...base,
      bug: { ...base.bug, enabled: scenario !== "enhancement" },
      enhancement: { ...base.enhancement, enabled: scenario !== "bug" },
    };
    const { connected, tools } = await listed({
      client: disabledBridge(),
      feedbackConfig,
      loadBugReporterModule: async () => bugModule(),
      loadEnhancementReporterModule: async () => enhancementModule(),
    });
    const names = tools.map(({ name }) => name);
    assert.equal(names.includes(FEEDBACK_TOOL_NAMES.bugSubmit), scenario !== "enhancement");
    assert.equal(names.includes(FEEDBACK_TOOL_NAMES.enhancementSubmit), scenario !== "bug");
    assert.equal(names.includes(FEEDBACK_TOOL_NAMES.discover), true);
    await connected.close();
  });
}

test("missing verified session and missing SDK are actionable and expose no reporter mutations", async () => {
  const { connected, tools } = await listed({
    client: disabledBridge(),
    feedbackConfig: { ...base, sessionToken: undefined },
    loadBugReporterModule: async () => bugModule(),
    loadEnhancementReporterModule: async () => { throw Object.assign(new Error("missing"), { code: "ERR_MODULE_NOT_FOUND" }); },
  });
  assert.deepEqual(tools.map(({ name }) => name), [FEEDBACK_TOOL_NAMES.discover]);
  const result = JSON.parse((await connected.client.callTool({ name: FEEDBACK_TOOL_NAMES.discover, arguments: {} })).content[0].text);
  assert.equal(result.reporters.bug.reason, "verified_session_required");
  assert.equal(result.reporters.enhancement.reason, "sdk_not_installed");
  assert.doesNotMatch(JSON.stringify(result), /bug-secret|enhancement-secret/u);
  await connected.close();
});

test("discovery rejects unverified bug identity and an inexact enhancement service binding", async () => {
  const { connected, tools } = await listed({
    client: disabledBridge(),
    feedbackConfig: base,
    loadBugReporterModule: async () => bugModule([], {
      schemaVersion: 1,
      projectId: "project-1",
      environment: "staging",
      identityVerified: false,
    }),
    loadEnhancementReporterModule: async () => enhancementModule([], {
      contract_version: "v1",
      capability: { id: "enhancement-1", project_id: "project-1", service_env_id: "different-service-env" },
      principal: { authenticated: true, authentication_method: "known_users_direct_session" },
      enhancement_reporting: { enabled: true },
    }),
  });
  assert.deepEqual(tools.map(({ name }) => name), [FEEDBACK_TOOL_NAMES.discover]);
  const readiness = JSON.parse((await connected.client.callTool({ name: FEEDBACK_TOOL_NAMES.discover, arguments: {} })).content[0].text);
  assert.equal(readiness.reporters.bug.reason, "canonical_discovery_mismatch");
  assert.equal(readiness.reporters.enhancement.reason, "canonical_discovery_mismatch");
  await connected.close();
});

test("reporter submits use canonical adapters and cannot carry execution authority", async () => {
  const calls = [];
  const { connected, tools } = await listed({
    client: disabledBridge(),
    feedbackConfig: base,
    loadBugReporterModule: async () => bugModule(calls),
    loadEnhancementReporterModule: async () => enhancementModule(calls),
  });
  const enhancementTool = tools.find(({ name }) => name === FEEDBACK_TOOL_NAMES.enhancementSubmit);
  const bugTool = tools.find(({ name }) => name === FEEDBACK_TOOL_NAMES.bugSubmit);
  assert.equal(bugTool.inputSchema.required.includes("event_id"), true);
  for (const forbidden of ["run_codex", "ci_cd", "auto_commit_push", "auto_deploy_env", "requested_delivery_ceiling"]) {
    assert.equal(Object.hasOwn(enhancementTool.inputSchema.properties, forbidden), false);
  }
  await connected.client.callTool({ name: FEEDBACK_TOOL_NAMES.bugSubmit, arguments: { event_id: "conversation:bug:1", title: "Broken", description: "It failed", impact: "high" } });
  await connected.client.callTool({ name: FEEDBACK_TOOL_NAMES.enhancementSubmit, arguments: { idempotency_key: "conversation:1", external_conversation_id: "conversation", title: "Improve it", description: "Add a saved view" } });
  assert.deepEqual(calls.map(([name]) => name), ["bug.submit", "enhancement.submit"]);
  assert.equal(calls[0][1].impact, "high");
  assert.equal(calls[0][1].eventId, "conversation:bug:1");
  assert.equal(calls[1][1].submission_kind, "enhancement");
  assert.equal(calls[1][1].source, "web_enhancement_reporter");
  for (const forbidden of ["run_codex", "ci_cd", "auto_commit_push", "auto_deploy_env", "requested_delivery_ceiling"]) {
    assert.equal(Object.hasOwn(calls[1][1], forbidden), false);
  }
  await connected.close();
});

test("direct Work Request compatibility is separately named when feedback mode is active", async () => {
  const { connected, tools } = await listed({
    client: enabledBridge(),
    discovery,
    feedbackConfig: { enabled: true, sessionToken: "session-1" },
  });
  const names = tools.map(({ name }) => name);
  assert.equal(names.includes("assistant_change_bridge_v1_submit"), false);
  assert.equal(names.includes(DEVELOPER_TOOL_NAMES.submit), true);
  assert.equal(names.includes(FEEDBACK_TOOL_NAMES.discover), true);
  await connected.close();
});
