import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { API_CONTRACT_VERSION } from "../src/version.js";

export const enabledConfig = Object.freeze({
  enabled: true,
  apiUrl: "https://handrail.example.test/api/assistant-change-bridge/v1",
  contractVersion: API_CONTRACT_VERSION,
  projectId: "project-001",
  capabilityId: "capability-001",
  token: "server-only-secret",
  issuer: "https://issuer.example.test",
  subject: "subject-001",
  retryBaseDelayMs: 0,
  retryMaxDelayMs: 0,
});

export const discovery = Object.freeze({
  contract_version: API_CONTRACT_VERSION,
  enabled: true,
  capability: {
    id: "capability-001",
    project_id: "project-001",
    repo_id: "repo-001",
    service_env_id: "service-env-001",
    environment: "staging",
    kb_slugs: [],
  },
  principal: { issuer: enabledConfig.issuer, subject: enabledConfig.subject },
  policy: {
    allowed_modes: ["work_request"],
    delivery_ceiling: "staging",
    creates_work_requests: true,
    creates_owner_goals: false,
    production_available: false,
    cancellation: "canonical_lifecycle",
  },
  operations: ["discover", "submit", "lookup", "clarify", "cancel"],
  resources: [{
    name: "bridge-contract",
    title: "Bridge contract",
    uri: "handrail://knowledge-base/bridge-contract",
    mime_type: "text/markdown",
    read_path: "resources/knowledge-base/bridge-contract",
  }],
  prompts: [{
    name: "submit-change",
    title: "Submit change",
    path: "prompts/submit-change",
    arguments: [{ name: "goal", required: true }],
  }],
});

export function response(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    text: async () => payload == null ? "" : JSON.stringify(payload),
  };
}

export function requestRecord(overrides = {}) {
  return {
    id: "bridge-request-001",
    contract_version: API_CONTRACT_VERSION,
    capability_id: "capability-001",
    project_id: "project-001",
    issuer: enabledConfig.issuer,
    subject: enabledConfig.subject,
    idempotency_key: "conversation-1:turn-1",
    external_conversation_id: "conversation-1",
    requested_mode: "work_request",
    requested_delivery_ceiling: "work_request",
    effective_delivery_ceiling: "work_request",
    title: "Add dashboard",
    status: "needs_attention",
    terminal: false,
    clarification_history: [],
    linked_pm_record: null,
    linked_work_request: { id: "work-request-001" },
    audit_lineage: [],
    terminal_evidence: { work_request_created: true, work_request_id: "work-request-001", owner_goal_created: false },
    ...overrides,
  };
}

export async function connectInMemory(server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "handrail-mcp-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
