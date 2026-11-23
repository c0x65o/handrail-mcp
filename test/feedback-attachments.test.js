import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import test from "node:test";
import { createAppFeedbackTools, createFeedbackUploads, FEEDBACK_TOOL_NAMES as names } from "@handrail/mcp/feedback";
import { startStreamableHttp } from "../src/transports.js";

const user = { principalId: "alice", tenantId: "company" };
const getVerifiedUser = actor => actor;
const key = Buffer.alloc(32, 7);
const fileLimit = 5 * 1024 * 1024;
const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
function file(size, filename = "file.docx") {
  return { filename, data_url: "data:" + mime + ";base64," + Buffer.alloc(size, 65).toString("base64") };
}
function setup(options = {}) {
  const calls = [];
  const binding = { enabled: true, projectId: "project", serviceEnvId: "service", environment: "staging" };
  const mockFetch = async (url, init) => {
    const target = new URL(url);
    const headers = new globalThis.Headers(init.headers);
    const [claim, mac] = headers.get("x-handrail-feedback-proof").split(".");
    assert.equal(mac, createHmac("sha256", key).update(claim).digest("base64url"));
    const proof = JSON.parse(Buffer.from(claim, "base64url"));
    const body = init.body ? JSON.parse(init.body) : null;
    assert.equal(proof.requestHash, createHash("sha256").update(JSON.stringify([init.method, target.pathname + target.search, headers.get("idempotency-key"), body])).digest("hex"));
    assert.equal(proof.subject, user.principalId);
    assert.equal(proof.tenant, user.tenantId);
    const identity = { subject: proof.subject, service_env_id: "service", authentication_method: "verified_app_invocation" };
    if (target.pathname.endsWith("/policy")) return globalThis.Response.json({
      schema_version: 1, project_id: "project", environment: "staging", document_attachments: true,
      reporter: { identity_verified: true }, app_feedback: identity,
    });
    if (target.pathname.endsWith("/discovery")) return globalThis.Response.json({
      contract_version: "v1", enhancement_reporting: { enabled: true }, document_attachments: true,
      principal: { authenticated: true, ...identity }, capability: { id: "cap", project_id: "project", service_env_id: "service", environment: "staging" },
    });
    calls.push({ proof, body, path: target.pathname, method: init.method });
    return globalThis.Response.json({ contract_version: "v1", bug_id: "bug" });
  };
  const tools = createAppFeedbackTools({ getVerifiedUser, ...options, config: {
    issuerKey: key.toString("base64url"),
    bug: { ...binding, apiBaseUrl: "https://example.test", reportToken: "token", fetch: mockFetch },
    enhancement: { ...binding, apiUrl: "https://example.test/v1", token: "token", capabilityId: "cap", contractVersion: "v1", fetch: mockFetch },
  } });
  return { tool: name => tools.find(t => t.name === name), calls };
}
const bug = { title: "Issue", description: "Details", event_id: "test-intent" };
const enhancement = { title: "Idea", description: "Details", idempotency_key: "idea", external_conversation_id: "chat" };
function upload(uploads, actor, bytes) {
  return uploads.handle(new globalThis.Request("https://app.test/mcp/feedback/uploads?filename=a.txt", {
    method: "POST", headers: { "content-type": "text/plain" }, body: bytes,
  }), actor);
}

test("both signed submit routes receive the full inline batch and reject excess before forwarding", async () => {
  const { tool, calls } = setup();
  const attachments = [file(fileLimit), file(fileLimit), file(fileLimit - 1), file(1)];
  for (const [surface, input, path] of [["bug", bug, "/api/mobile-bug-reports/app-feedback"], ["enhancement", enhancement, "/v1/requests"]]) {
    const submit = tool(names[surface + "Submit"]);
    await submit.call(user, { ...input, attachments });
    assert.equal(calls.at(-1).path, path);
    assert.deepEqual(calls.at(-1).body.attachments, attachments);
    await assert.rejects(submit.call(user, { ...input, attachments: [file(fileLimit + 1)] }), /5 MiB/);
    await assert.rejects(submit.call(user, { ...input, attachments: [...attachments.slice(0, 3), file(2)] }), /15 MiB/);
    await assert.rejects(submit.call(user, { ...input, attachments: Array(5).fill(file(1)) }), /4 attachments/);
  }
  assert.equal(calls.length, 2);
});

test("raw upload IDs resolve only for their verified actor on either submit, including retries", async () => {
  const uploads = createFeedbackUploads({ getVerifiedUser });
  assert.equal((await upload(uploads, null, "hi")).status, 403);
  assert.equal((await upload(uploads, user, Buffer.alloc(fileLimit + 1))).status, 413);
  const staged = await upload(uploads, user, Buffer.alloc(fileLimit, 65));
  assert.equal(staged.status, 201);
  const { upload_id } = await staged.json();
  const { tool, calls } = setup({ uploads });
  for (const [name, input] of [[names.bugSubmit, bug], [names.enhancementSubmit, enhancement]]) {
    const submit = tool(name);
    const args = { ...input, upload_ids: [upload_id] };
    for (const actor of [{ ...user, principalId: "bob" }, { ...user, tenantId: "other" }])
      await assert.rejects(submit.call(actor, args), /unavailable/);
    await submit.call(user, args);
    assert.equal(calls.at(-1).body.attachments[0].data_url, "data:text/plain;base64," + Buffer.alloc(fileLimit, 65).toString("base64"));
    assert.equal(calls.at(-1).body.upload_ids, undefined);
    await assert.rejects(submit.call(user, { ...args, attachments: Array(4).fill(file(1)) }), /4 attachments/);
    await assert.rejects(submit.call(user, { ...args, attachments: [file(fileLimit), file(fileLimit), file(1)] }), /15 MiB/);
  }
});

test("post-submit tools require opt-in and sign the exact owned attachment operation", async () => {
  const defaults = setup();
  const { tool, calls } = setup({ attachmentTools: true });
  for (const surface of ["bug", "enhancement"]) {
    const collection = surface === "bug" ? "/api/mobile-bug-reports/bugs/r/attachments" : "/v1/requests/r/attachments";
    for (const [operation, args, method, path] of [
      ["addAttachments", { attachments: [file(1)] }, "POST", collection],
      ["listAttachments", {}, "GET", collection],
      ["getAttachment", { attachment_id: "a" }, "GET", collection + "/a/content"],
    ]) {
      const name = names[surface + operation[0].toUpperCase() + operation.slice(1)];
      assert.equal(defaults.tool(name), undefined);
      await tool(name).call(user, { request_id: "r", ...args });
      assert.equal(calls.at(-1).proof.operation, operation);
      assert.equal(calls.at(-1).path, path);
      assert.equal(calls.at(-1).method, method);
    }
  }
});

test("served /mcp forwards a maximum inline submit and returns 413 above its JSON limit", async t => {
  let received = 0;
  const running = await startStreamableHttp({ port: 0, config: { enabled: false }, feedbackConfig: {
    bug: { enabled: true, apiBaseUrl: "https://example.test", reportToken: "token", projectId: "p", environment: "staging", serviceEnvId: "s",
      fetch: async (url, init) => {
        if (url.endsWith("/mobile-bug-reports")) {
          received = JSON.parse(init.body).attachments.length;
          return globalThis.Response.json({ bug_id: "b" });
        }
        return globalThis.Response.json({ schema_version: 1, project_id: "p", environment: "staging", reporter: { identity_verified: true }, document_attachments: true });
      } },
  } });
  t.after(() => running.close());
  const send = body => fetch(`http://127.0.0.1:${running.address.port}/mcp`, { method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json", "x-handrail-application-session": "session" }, body });
  const res = await send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
    name: names.bugSubmit, arguments: { ...bug, attachments: Array(3).fill(file(fileLimit)) },
  } }));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /submitted/);
  assert.equal(received, 3);
  assert.equal((await send(Buffer.alloc(25 * 1024 * 1024 + 1))).status, 413);
});
