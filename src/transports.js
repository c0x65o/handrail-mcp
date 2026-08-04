import { createServer } from "node:http";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createConnectorServer } from "./server.js";

function jsonRpcError(res, status, message) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

export async function startStdio(options = {}) {
  const connector = await createConnectorServer(options);
  const transport = new StdioServerTransport();
  await connector.server.connect(transport);
  return {
    ...connector,
    transport,
    close: async () => {
      await transport.close();
      await connector.server.close();
    },
  };
}

export async function startStreamableHttp({ host = "127.0.0.1", port = 3000, path = "/mcp", ...options } = {}) {
  const bootstrap = await createConnectorServer(options);
  await bootstrap.server.close();
  const active = new Set();
  const httpServer = createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (requestUrl.pathname !== path) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      jsonRpcError(res, 405, "Method not allowed.");
      return;
    }
    const connector = await createConnectorServer({ ...options, client: bootstrap.client, discovery: bootstrap.discovery });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    active.add({ connector, transport });
    try {
      await connector.server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) jsonRpcError(res, 500, "Internal server error.");
    } finally {
      await transport.close().catch(() => {});
      await connector.server.close().catch(() => {});
      for (const entry of active) {
        if (entry.transport === transport) active.delete(entry);
      }
    }
  });
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, resolve);
  });
  return {
    server: httpServer,
    address: httpServer.address(),
    discovery: bootstrap.discovery,
    config: bootstrap.config,
    close: async () => {
      for (const entry of active) {
        await entry.transport.close().catch(() => {});
        await entry.connector.server.close().catch(() => {});
      }
      await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    },
  };
}
