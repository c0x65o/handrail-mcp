import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createConnectorServer } from "../src/server.js";
import { connectInMemory } from "./helpers.js";

test("source tools require independent discovery and forward only the current session", async t => {
  const calls = [];
  const api = createServer(async (req, res) => {
    const body = [];
    for await (const chunk of req) body.push(chunk);
    const args = JSON.parse(Buffer.concat(body).toString());
    calls.push({ args, headers: req.headers });
    if (req.headers.authorization !== "Bearer fixture" || req.headers["x-handrail-application-session"] !== "session") {
      res.writeHead(403).end();
      return;
    }
    res.end(JSON.stringify(args.operation === "discover" ? { source_access: true } : { entries: [] }));
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => api.close(resolve)));
  const env = { HANDRAIL_PROJECT_SOURCE_API_URL: "http://127.0.0.1:" + api.address().port, HANDRAIL_PROJECT_SOURCE_TOKEN: "fixture" };
  for (const sessionToken of [undefined, "session"]) {
    const { server } = await createConnectorServer({ env, config: { sessionToken } });
    const { client, close } = await connectInMemory(server);
    try {
      const names = (await client.listTools()).tools.map(tool => tool.name).filter(name => name.startsWith("handrail_source_"));
      if (!sessionToken) assert.deepEqual(names, []);
      else {
        assert.deepEqual(names.sort(), ["handrail_source_read", "handrail_source_search", "handrail_source_tree"]);
        const result = await client.callTool({ name: "handrail_source_tree", arguments: {} });
        assert.deepEqual(JSON.parse(result.content[0].text), { entries: [] });
        assert.deepEqual(calls.at(-1).args, { operation: "tree" });
      }
    } finally {
      await close();
    }
  }
});
