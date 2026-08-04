import assert from "node:assert/strict";
import test from "node:test";

import { ContractVersionError, HandrailApiError } from "../src/errors.js";
import { HandrailClient } from "../src/client.js";
import { discovery, enabledConfig, requestRecord, response } from "./helpers.js";

test("default-deny and incomplete configurations make no HTTP requests", async () => {
  let calls = 0;
  const disabled = new HandrailClient({ fetch: async () => { calls += 1; } }, {});
  assert.equal(disabled.isEnabled(), false);
  assert.equal(disabled.getConfig().disabled_reason, "disabled");
  assert.equal(await disabled.discover(), null);

  const incomplete = new HandrailClient({ enabled: true, fetch: async () => { calls += 1; } }, {});
  assert.equal(incomplete.isEnabled(), false);
  assert.equal(incomplete.getConfig().disabled_reason, "missing_api_url");
  assert.ok(incomplete.getConfig().missing_config.includes("token"));
  assert.equal(calls, 0);
});

test("configuration and discovery reject incompatible API contracts", async () => {
  assert.throws(
    () => new HandrailClient({ ...enabledConfig, contractVersion: "v2" }, {}),
    ContractVersionError,
  );
  const client = new HandrailClient({
    ...enabledConfig,
    fetch: async () => response({ ...discovery, contract_version: "v2" }),
  }, {});
  await assert.rejects(client.discover(), (error) => error instanceof ContractVersionError && error.received === "v2");
});

test("idempotent submit retries the exact request while clarification does not", async () => {
  const calls = [];
  const client = new HandrailClient({
    ...enabledConfig,
    maxRetries: 1,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return calls.length === 1
        ? response({ error: "retry", code: "temporarily_unavailable" }, 503)
        : response({ request: requestRecord(), replayed: true });
    },
  }, {});
  const result = await client.submit({
    idempotency_key: "conversation-1:turn-1",
    external_conversation_id: "conversation-1",
    requested_mode: "feature",
    requested_delivery_ceiling: "intake_only",
    title: "Add dashboard",
  });
  assert.equal(result.replayed, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(calls[0].init.headers["idempotency-key"], "conversation-1:turn-1");
  assert.equal(calls[0].init.headers["x-handrail-principal-issuer"], enabledConfig.issuer);
  assert.equal(calls[0].init.headers["x-handrail-principal-subject"], enabledConfig.subject);

  let clarificationCalls = 0;
  const clarificationClient = new HandrailClient({
    ...enabledConfig,
    maxRetries: 3,
    fetch: async () => {
      clarificationCalls += 1;
      return response({ error: "retry", code: "temporarily_unavailable" }, 503);
    },
  }, {});
  await assert.rejects(clarificationClient.clarify({ request_id: "request-1", response: "Details" }), HandrailApiError);
  assert.equal(clarificationCalls, 1);
});

test("a per-request Known User session replaces static principal headers", async () => {
  const calls = [];
  const client = new HandrailClient({
    ...enabledConfig,
    issuer: undefined,
    subject: undefined,
    sessionToken: "application-session-001",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return response(discovery);
    },
  }, {});
  assert.equal(client.isEnabled(), true);
  assert.deepEqual(client.getConfig().principal, { source: "known_user_session" });
  await client.discover();
  assert.equal(calls[0].init.headers["x-handrail-application-session"], "application-session-001");
  assert.equal(calls[0].init.headers["x-handrail-principal-issuer"], undefined);
  assert.equal(calls[0].init.headers["x-handrail-principal-subject"], undefined);
});

test("authentication and revocation failures are bounded and redact response secrets", async () => {
  for (const [status, code] of [[401, "assistant_bridge_credential_revoked"], [403, "assistant_bridge_principal_denied"]]) {
    let calls = 0;
    const client = new HandrailClient({
      ...enabledConfig,
      fetch: async () => {
        calls += 1;
        return response({
          error: `Access denied for ${enabledConfig.token}`,
          code,
          token: "leaked-response-token",
          nested: { api_key: "leaked-key", safe: "visible" },
        }, status);
      },
    }, {});
    await assert.rejects(client.discover(), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.response.token, "[REDACTED]");
      assert.equal(error.response.nested.api_key, "[REDACTED]");
      assert.equal(error.response.nested.safe, "visible");
      assert.doesNotMatch(error.message, /server-only-secret/);
      assert.doesNotMatch(JSON.stringify(error), /leaked-response-token|leaked-key|server-only-secret/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("durable response validation accepts lifecycle statuses and rejects false terminal claims", async () => {
  const running = new HandrailClient({
    ...enabledConfig,
    fetch: async () => response(requestRecord({ status: "running", terminal: false })),
  }, {});
  assert.equal((await running.lookup({ request_id: "bridge-request-001" })).status, "running");

  const invalid = new HandrailClient({
    ...enabledConfig,
    fetch: async () => response(requestRecord({ status: "pending", terminal: true })),
  }, {});
  await assert.rejects(invalid.lookup({ request_id: "bridge-request-001" }), { code: "assistant_bridge_contract_mismatch" });
});

test("central resource endpoints cannot redirect credentials outside the bound API", async () => {
  const client = new HandrailClient({ ...enabledConfig, fetch: async () => assert.fail("fetch must not run") }, {});
  await assert.rejects(
    client.readResource({ name: "malicious", href: "https://attacker.example/steal" }),
    { code: "assistant_bridge_endpoint_scope_denied" },
  );
});
