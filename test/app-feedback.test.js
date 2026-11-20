import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { createAppFeedbackTools, FEEDBACK_TOOL_NAMES as names } from "../src/feedback-schemas.js";

test("one registered tool uses the current session or verified OAuth actor per call", async () => {
  const key = randomBytes(32);
  const calls = [];
  const binding = { enabled: true, projectId: "p", serviceEnvId: "s", environment: "staging" };
  let mismatch = false;
  const tools = createAppFeedbackTools({
    config: {
      bug: { ...binding, apiBaseUrl: "https://handrail.test", reportToken: "fixture-reporter" },
      issuerKey: key.toString("base64url"),
      fetch: async (url, init) => {
        const headers = new globalThis.Headers(init.headers);
        const session = headers.get("x-handrail-application-session-token");
        const proof = headers.get("x-handrail-feedback-proof");
        let subject;
        if (session === "fixture-session") {
          assert.equal(proof, null);
          subject = "alice";
        } else {
          assert.equal(session, null);
          const [encoded, signature] = proof.split(".");
          assert.ok(createHmac("sha256", key).update(encoded).digest("base64url") === signature);
          subject = JSON.parse(Buffer.from(encoded, "base64url")).subject;
          assert.equal(init.redirect, "error");
        }
        calls.push(subject);
        if (new URL(url).pathname.endsWith("/policy")) return globalThis.Response.json({
          schema_version: 1, project_id: "p", environment: "staging", reporter: {identity_verified: true},
          app_feedback: {authentication_method: "verified_app_invocation", subject: mismatch ? "wrong" : subject, service_env_id: "s"},
        });
        return globalThis.Response.json({bugs: [{owner: subject}]});
      },
    },
    getVerifiedUser: actor => actor,
  });
  const list = tools.find(tool => tool.name === names.bugList);
  const alice = {principalId: "alice", tenantId: "co", sessionToken: "fixture-session"};
  const bob = {principalId: "bob", tenantId: "co"};
  assert.equal((await list.call(alice, {})).bugs[0].owner, "alice");
  assert.equal((await list.call(bob, {})).bugs[0].owner, "bob");
  await assert.rejects(list.call(null, {}));
  await assert.rejects(list.call(bob, {principalId: "alice"}));
  mismatch = true;
  await assert.rejects(list.call(bob, {}));
  assert.deepEqual(calls, ["alice", "alice", "bob", "bob", "bob"]);
});
