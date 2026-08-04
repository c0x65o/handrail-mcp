import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { startStreamableHttp } from "../src/transports.js";
import { discovery, enabledConfig, response } from "./helpers.js";

test("Streamable HTTP starts, serves MCP, and shuts down cleanly", async () => {
  const running = await startStreamableHttp({
    host: "127.0.0.1",
    port: 0,
    config: { ...enabledConfig, fetch: async () => response(discovery) },
  });
  const address = running.address;
  const client = new Client({ name: "http-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 5);
  await client.close();
  await running.close();
  assert.equal(running.server.listening, false);
});

test("stdio CLI starts as an MCP server and the client closes it", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("src/cli.js")],
    env: { ...process.env, HANDRAIL_ASSISTANT_BRIDGE_ENABLED: "false" },
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools, []);
  await client.close();
  assert.ok(transport);
});
