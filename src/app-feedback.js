import { createHmac, createHash } from "node:crypto";
import { z } from "zod/v4";
import { FEEDBACK_TOOL_DEFINITIONS } from "./feedback-schemas.js";
import { callFeedbackAdapter } from "./feedback-adapters.js";

import { resolveFeedbackConfig } from "./feedback-config.js";
import { attachmentBatch, verifiedActor } from "./feedback-attachments.js";

const attachmentOperations = new Set(["addAttachments", "listAttachments", "getAttachment"]);
const operations = new Set(["submit", "list", "lookup", "answer"]);

/** The host passes its current authenticated actor after applying its ordinary tool permissions. */
export function createAppFeedbackTools({ config, getVerifiedUser, uploads, attachmentTools = false }) {
  if (typeof getVerifiedUser !== "function") {
    throw new TypeError("Feedback requires a verified user hook");
  }
  return FEEDBACK_TOOL_DEFINITIONS.filter(tool => operations.has(tool.operation) || (attachmentTools === true && attachmentOperations.has(tool.operation))).map(tool => {
    if (!config[tool.surface]?.enabled) return null;
    const schema = uploads && tool.operation === "submit"
      ? z.strictObject({ ...tool.schema, upload_ids: z.array(z.string().uuid()).min(1).max(4, "At most 4 attachments are allowed.").optional() })
      : z.strictObject(tool.schema);
    return Object.freeze({
      name: tool.name, description: tool.description, readOnly: tool.readOnly === true, schema,
      inputSchema: z.toJSONSchema(schema, {io: "input"}),
      async call(context, input) {
        const args = schema.parse(input);
        const user = await getVerifiedUser(context);
        if (!verifiedActor(user)) {
          throw new Error("Verified feedback user required");
        }
        const binding = config[tool.surface];
        if (!binding?.enabled || !binding.projectId || !binding.serviceEnvId || !binding.environment) {
          throw new Error("Feedback runtime is unavailable");
        }
        const issuerKey = config.issuerKey ?? process.env.HANDRAIL_FEEDBACK_ISSUER_KEY;
        if (!user.sessionToken && (typeof issuerKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(issuerKey))) throw new Error("Feedback issuer is unavailable");
        const sessionToken = user.sessionToken;
        const transport = binding.fetch ?? config.fetch ?? globalThis.fetch;
        const signedFetch = async (url, init) => {
          const target = new URL(url);
          const headers = new globalThis.Headers(init.headers);
          const requestHash = createHash("sha256").update(JSON.stringify([init.method ?? "GET",
            target.pathname + target.search, headers.get("idempotency-key"), init.body ? JSON.parse(init.body) : null])).digest("hex");
          const claim = Buffer.from(JSON.stringify({ projectId: binding.projectId, serviceEnvId: binding.serviceEnvId,
            environment: binding.environment, subject: user.principalId, tenant: user.tenantId, surface: tool.surface,
            operation: tool.operation, issuedAt: Date.now(), requestHash })).toString("base64url");
          const signature = createHmac("sha256", Buffer.from(issuerKey, "base64url")).update(claim).digest("base64url");
          headers.set("x-handrail-feedback-proof", claim + "." + signature);
          return transport(url, { ...init, headers, redirect: "error" });
        };
        const activeConfig = resolveFeedbackConfig({
          sessionToken, feedbackProof: !sessionToken, subject: user.principalId, [tool.surface]: { ...binding, fetch: sessionToken ? transport : signedFetch } }, {});
        if (tool.operation === "submit") {
          if (args.upload_ids) {
            if ((args.attachments?.length ?? 0) + args.upload_ids.length > 4) throw new Error("At most 4 attachments are allowed.");
            args.attachments = attachmentBatch.parse([...(args.attachments ?? []), ...uploads.resolve(args.upload_ids, user)]);
            delete args.upload_ids;
          }
          const field = tool.surface === "bug" ? "event_id" : "idempotency_key";
          args[field] = createHash("sha256").update(JSON.stringify([binding.projectId, binding.serviceEnvId,
            user.tenantId, user.principalId, args[field]])).digest("hex");
        }
        return callFeedbackAdapter({config: activeConfig}, tool, args);
      },
    });
  }).filter(Boolean);
}
