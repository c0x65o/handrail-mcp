import { randomUUID } from "node:crypto";
import { z } from "zod/v4";

const fileLimit = 5 * 1024 * 1024;
const totalLimit = 3 * fileLimit;
export const MCP_BODY_LIMIT_BYTES = 25 * 1024 * 1024;
const maxUrlLength = Math.ceil(fileLimit / 3) * 4 + 128;

export const attachmentBatch = z.array(z.strictObject({
  filename: z.string().min(1).max(160),
  data_url: z.string().max(maxUrlLength, "Each attachment must be at most 5 MiB.")
    .describe("Base64 data URL with the matching document or image MIME type."),
})).min(1).max(4, "At most 4 attachments are allowed.").superRefine((files, ctx) => {
  let total = 0;
  for (const [index, file] of files.entries()) {
    const match = /^data:[^;,]{1,100};base64,/u.exec(file.data_url);
    const encoded = match && file.data_url.slice(match[0].length);
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
      ctx.addIssue({ code: "custom", path: [index, "data_url"], message: "Expected a base64 data URL." });
      continue;
    }
    const size = Buffer.byteLength(encoded, "base64");
    if (size > fileLimit) ctx.addIssue({ code: "custom", path: [index], message: "Each attachment must be at most 5 MiB." });
    total += size;
  }
  if (total > totalLimit) ctx.addIssue({ code: "custom", message: "Attachments may total at most 15 MiB." });
});

export function verifiedActor(user) {
  return [user?.principalId, user?.tenantId].every(id => typeof id === "string" && id.trim() && id.length <= 500);
}

// One instance per application binding. Keep IDs valid for exact submit retries.
export function createFeedbackUploads({ getVerifiedUser }) {
  if (typeof getVerifiedUser !== "function") throw new TypeError("Uploads require a verified user hook.");
  const files = new Map();
  let inFlight = 0;
  return {
    async handle(request, context) {
      const reply = (status, body) => globalThis.Response.json(body, { status, headers: { "cache-control": "no-store" } });
      if (request.method !== "POST") return reply(405, { error: "POST required." });
      const user = await getVerifiedUser(context);
      if (!verifiedActor(user)) return reply(403, { error: "Verified feedback user required." });
      const filename = new URL(request.url).searchParams.get("filename");
      const mime = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (!filename?.trim() || filename.length > 160 || !/^[\w.+-]+\/[\w.+-]+$/u.test(mime ?? "") || mime.length > 100)
        return reply(400, { error: "Supply a filename and file Content-Type." });
      if (Number(request.headers.get("content-length")) > fileLimit) return reply(413, { error: "Each attachment must be at most 5 MiB." });
      if (!request.body) return reply(400, { error: "Empty attachment." });
      if (files.size + inFlight >= 32) return reply(429, { error: "Upload staging is full. Try again later." });
      inFlight++;
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of request.body) {
          size += chunk.length;
          if (size > fileLimit) return reply(413, { error: "Each attachment must be at most 5 MiB." });
          chunks.push(chunk);
        }
        if (!size) return reply(400, { error: "Empty attachment." });
        const id = randomUUID();
        const ttl = 10 * 60_000;
        files.set(id, { filename, mime, bytes: Buffer.concat(chunks, size), expires: Date.now() + ttl,
          principal: user.principalId, tenant: user.tenantId });
        setTimeout(() => files.delete(id), ttl).unref();
        return reply(201, { upload_id: id });
      } finally {
        inFlight--;
      }
    },
    resolve(ids, user) {
      return ids.map(id => {
        const file = files.get(id);
        if (!file || file.expires <= Date.now() || file.principal !== user.principalId || file.tenant !== user.tenantId)
          throw new Error("Feedback upload unavailable for this user or expired.");
        return { filename: file.filename, data_url: `data:${file.mime};base64,${file.bytes.toString("base64")}` };
      });
    },
  };
}
