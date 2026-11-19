import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

function json(body, status = 200) {
  return new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bugPolicy(overrides = {}) {
  return {
    schema_version: 1,
    project_id: "project-1",
    environment: "staging",
    reporter: { identity_verified: true, access_level: "default", role: "requester" },
    ask_options: [],
    ...overrides,
  };
}

function enhancementDiscovery(overrides = {}) {
  return {
    contract_version: "v1",
    capability: { id: "enhancement-1", project_id: "project-1", service_env_id: "service-env-1" },
    principal: { authenticated: true, authentication_method: "known_users_direct_session" },
    enhancement_reporting: { enabled: true },
    ...overrides,
  };
}

function feedbackFetch(calls = [], options = {}) {
  return async (url, init = {}) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: parsed, init, body });
    if (parsed.pathname.endsWith("/api/mobile-bug-reports/policy")) {
      return json(options.bugPolicy || bugPolicy());
    }
    if (parsed.pathname.endsWith("/api/enhancement-reporting/v1/discovery")) {
      return json(options.enhancementDiscovery || enhancementDiscovery());
    }
    if (parsed.pathname.endsWith("/api/mobile-bug-reports") && init.method === "POST") {
      return json({ bug_id: "bug-1" }, 201);
    }
    if (parsed.pathname.endsWith("/api/enhancement-reporting/v1/requests") && init.method === "POST") {
      return json({ contract_version: "v1", request: { id: "request-1", contract_version: "v1" } }, 201);
    }
    throw new Error(`Unexpected feedback request: ${init.method || "GET"} ${parsed.pathname}`);
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

test("package and runtime source have no reporter SDK dependency", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const adapters = await readFile(new URL("../src/feedback-adapters.js", import.meta.url), "utf8");
  const clients = await readFile(new URL("../src/feedback-clients.js", import.meta.url), "utf8");
  for (const packageName of ["@handrail/bug-reporter", "@handrail/enhancement-reporter"]) {
    assert.equal(manifest.dependencies?.[packageName], undefined);
    assert.equal(manifest.peerDependencies?.[packageName], undefined);
    assert.equal(manifest.optionalDependencies?.[packageName], undefined);
    assert.doesNotMatch(`${adapters}\n${clients}`, new RegExp(`${packageName.replace("/", "\\/")}/server`, "u"));
  }
});

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
      fetch: feedbackFetch(),
      bug: { ...base.bug, enabled: scenario !== "enhancement" },
      enhancement: { ...base.enhancement, enabled: scenario !== "bug" },
    };
    const { connected, tools } = await listed({
      client: disabledBridge(),
      feedbackConfig,
    });
    const names = tools.map(({ name }) => name);
    assert.equal(names.includes(FEEDBACK_TOOL_NAMES.bugSubmit), scenario !== "enhancement");
    assert.equal(names.includes(FEEDBACK_TOOL_NAMES.enhancementSubmit), scenario !== "bug");
    assert.equal(names.includes(FEEDBACK_TOOL_NAMES.discover), true);
    await connected.close();
  });
}

test("missing verified session is actionable and exposes no reporter mutations", async () => {
  const calls = [];
  const { connected, tools } = await listed({
    client: disabledBridge(),
    feedbackConfig: { ...base, sessionToken: undefined, fetch: feedbackFetch(calls) },
  });
  assert.deepEqual(tools.map(({ name }) => name), [FEEDBACK_TOOL_NAMES.discover]);
  const result = JSON.parse((await connected.client.callTool({ name: FEEDBACK_TOOL_NAMES.discover, arguments: {} })).content[0].text);
  assert.equal(result.reporters.bug.reason, "verified_session_required");
  assert.equal(result.reporters.enhancement.reason, "verified_session_required");
  assert.equal(calls.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /bug-secret|enhancement-secret/u);
  await connected.close();
});

test("discovery rejects unverified bug identity and an inexact enhancement service binding", async () => {
  const fetch = feedbackFetch([], {
    bugPolicy: bugPolicy({
      reporter: { identity_verified: false, access_level: "default", role: "requester" },
    }),
    enhancementDiscovery: enhancementDiscovery({
      capability: { id: "enhancement-1", project_id: "project-1", service_env_id: "different-service-env" },
    }),
  });
  const { connected, tools } = await listed({
    client: disabledBridge(),
    feedbackConfig: { ...base, fetch },
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
    feedbackConfig: { ...base, fetch: feedbackFetch(calls) },
  });
  const enhancementTool = tools.find(({ name }) => name === FEEDBACK_TOOL_NAMES.enhancementSubmit);
  const bugTool = tools.find(({ name }) => name === FEEDBACK_TOOL_NAMES.bugSubmit);
  assert.equal(bugTool.inputSchema.required.includes("event_id"), true);
  for (const forbidden of ["run_codex", "ci_cd", "auto_commit_push", "auto_deploy_env", "requested_delivery_ceiling"]) {
    assert.equal(Object.hasOwn(enhancementTool.inputSchema.properties, forbidden), false);
  }
  await connected.client.callTool({ name: FEEDBACK_TOOL_NAMES.bugSubmit, arguments: { event_id: "conversation:bug:1", title: "Broken", description: "It failed", impact: "high" } });
  await connected.client.callTool({ name: FEEDBACK_TOOL_NAMES.enhancementSubmit, arguments: { idempotency_key: "conversation:1", external_conversation_id: "conversation", title: "Improve it", description: "Add a saved view" } });
  const bugCall = calls.find(({ url, init }) => url.pathname.endsWith("/api/mobile-bug-reports") && init.method === "POST");
  const enhancementCall = calls.find(({ url, init }) => url.pathname.endsWith("/api/enhancement-reporting/v1/requests") && init.method === "POST");
  assert.equal(bugCall.body.severity, "high");
  assert.equal(bugCall.body.event_id, "conversation:bug:1");
  assert.equal(bugCall.body.reporter_sdk_package, "@handrail/mcp");
  assert.equal(bugCall.init.headers["x-handrail-application-session-token"], "session-1");
  assert.equal(enhancementCall.body.submission_kind, "enhancement");
  assert.equal(enhancementCall.body.reporter_sdk.package, "@handrail/mcp");
  assert.equal(enhancementCall.init.headers["x-handrail-application-session"], "session-1");
  assert.equal(enhancementCall.init.headers["idempotency-key"], "conversation:1");
  for (const forbidden of ["run_codex", "ci_cd", "auto_commit_push", "auto_deploy_env", "requested_delivery_ceiling"]) {
    assert.equal(Object.hasOwn(enhancementCall.body, forbidden), false);
  }
  await connected.close();
});

test("direct Work Request compatibility is separately named when feedback mode is active", async () => {
  const { connected, tools } = await listed({
    profile: "extended", client: enabledBridge(),
    discovery,
    feedbackConfig: { enabled: true, sessionToken: "session-1" },
  });
  const names = tools.map(({ name }) => name);
  assert.equal(names.includes("assistant_change_bridge_v1_submit"), false);
  assert.equal(names.includes(DEVELOPER_TOOL_NAMES.submit), true);
  assert.equal(names.includes(FEEDBACK_TOOL_NAMES.discover), true);
  await connected.close();
});

test("feedback-only registers exactly the conversation tools and sends scoped answers", async (t) => {
  const transport = feedbackFetch([], {
    bugPolicy: bugPolicy({ reporter_observations: { available: true } }),
    enhancementDiscovery: enhancementDiscovery({
      reporter_observations: { available: true },
      enhancement_reporting: { enabled: true, workflow: { clarification_response: true } },
    }),
  });
  const question = { information_request_id: "q1", question: "Which view?", options: ["Current", "All"] };
  const fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/policy") || path.endsWith("/discovery")) return transport(url, init);
    const bug = path.startsWith("/api/mobile-bug-reports/");
    const record = { id: "r1", information_request: question };
    if (init.method === "GET") {
      if (bug) return json(path.endsWith("/mine") ? { bugs: [record] } : { bug: record });
      return json({ contract_version: "v1", ...(path.endsWith("/requests") ? { requests: [record] } : record) });
    }
    assert.equal(init.method, "POST");
    assert.equal(init.headers[bug ? "x-handrail-application-session-token" : "x-handrail-application-session"], "session-1");
    assert.equal(path, bug ? "/api/mobile-bug-reports/bugs/r1/information-requests/q1/answer"
      : "/api/enhancement-reporting/v1/requests/r1/clarifications");
    assert.deepEqual(JSON.parse(init.body), bug ? { option: "Current" }
      : { information_request_id: "q1", option: "Current", answer: "At login" });
    return json({ contract_version: "v1", answered: true });
  };
  const { connected, tools } = await listed({
    client: { getConfig: () => ({ enabled: true }), discover: () => assert.fail("developer discovery") },
    feedbackConfig: { ...base, fetch }, env: {},
  });
  t.after(() => connected.close());
  const expected = [FEEDBACK_TOOL_NAMES.discover];
  for (const kind of ["bug", "enhancement"]) {
    for (const operation of ["Submit", "List", "Lookup", "Answer", "FollowUp", "StopFollowUp"]) {
      expected.push(FEEDBACK_TOOL_NAMES[kind + operation]);
    }
    const call = async (op, args) => (await connected.client.callTool({
      name: FEEDBACK_TOOL_NAMES[kind + op], arguments: args,
    })).structuredContent;
    const list = await call("List", {});
    const [item] = list.bugs ?? list.requests;
    const lookup = await call("Lookup", { request_id: item.id });
    assert.deepEqual(item.information_request, question);
    assert.deepEqual(lookup.information_request, question);
    assert.equal((await call("Answer", { request_id: item.id, information_request_id: question.information_request_id,
      option: "Current", ...(kind === "enhancement" ? { answer: "At login" } : {}) })).answered, true);
  }
  assert.deepEqual(tools.map(tool => tool.name).sort(), expected.sort());
});
