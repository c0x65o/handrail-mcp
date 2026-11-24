import * as z from "zod/v4";

const path = z.string().max(1024);
const offset = z.number().int().nonnegative().optional();
const tools = [
  ["tree", "List one directory of committed project source. Follow next_offset for more entries.", { path: path.optional(), offset }],
  ["search", "Find literal text in committed source. Returns matching lines. Follow next_offset to scan more files.", { query: z.string().min(1).max(256), path: path.optional(), offset }],
  ["read", "Read a file starting at line 1 or start_line. Follow next_start_line for more context.", { path, start_line: z.number().int().positive().optional(), max_lines: z.number().int().min(1).max(200).optional() }],
];

export async function registerProjectSource(server, env, session) {
  const url = env.HANDRAIL_PROJECT_SOURCE_API_URL;
  const token = env.HANDRAIL_PROJECT_SOURCE_TOKEN;
  if (!url || !token) return;
  const target = new URL(url);
  if (target.protocol !== "https:" && !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))) throw new Error("Project source requires HTTPS or loopback.");
  const request = async (operation, args) => {
    const headers = { authorization: "Bearer " + token, "content-type": "application/json" };
    if (session) headers["X-Handrail-Application-Session"] = session;
    return fetch(target, { method: "POST", headers, body: JSON.stringify({ ...args, operation }), redirect: "error", signal: globalThis.AbortSignal.timeout(20000) });
  };
  // Availability of this optional reader is independent of feedback and developer tools.
  try {
    const discovery = await request("discover", {});
    if (!discovery.ok || (await discovery.json()).source_access !== true) return;
  } catch {
    return;
  }
  for (const [operation, description, inputSchema] of tools) {
    server.registerTool("handrail_source_" + operation, {
      description: description + " Use for specific questions. Submit requested fixes through feedback.",
      inputSchema, annotations: { readOnlyHint: true },
    }, async args => {
      try {
        const response = await request(operation, args);
        if (!response.ok) return { isError: true, content: [{ type: "text", text: "Source request failed (" + response.status + ")." }] };
        return { content: [{ type: "text", text: JSON.stringify(await response.json()) }] };
      } catch {
        return { isError: true, content: [{ type: "text", text: "Source service unavailable." }] };
      }
    });
  }
}
