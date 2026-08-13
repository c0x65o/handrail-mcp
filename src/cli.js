#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { startStdio, startStreamableHttp } from "./transports.js";
import { API_CONTRACT_VERSION, CONNECTOR_NAME, CONNECTOR_VERSION } from "./version.js";

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function help() {
  return `Usage: handrail-mcp [--transport stdio|http] [--host HOST] [--port PORT] [--path PATH]\n\n${CONNECTOR_NAME} ${CONNECTOR_VERSION}\nHandrail API contract ${API_CONTRACT_VERSION}`;
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`${CONNECTOR_NAME} ${CONNECTOR_VERSION} (Handrail API ${API_CONTRACT_VERSION})`);
    return null;
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(help());
    return null;
  }
  const transportName = option(args, "--transport", process.env.HANDRAIL_MCP_TRANSPORT || "stdio");
  if (transportName === "stdio") return startStdio();
  if (transportName !== "http" && transportName !== "streamable-http") {
    throw new Error(`Unsupported MCP transport '${transportName}'.`);
  }
  const port = Number.parseInt(option(args, "--port", process.env.PORT || "3000"), 10);
  const host = option(args, "--host", process.env.HOST || "127.0.0.1");
  const path = option(args, "--path", process.env.HANDRAIL_MCP_HTTP_PATH || "/mcp");
  const running = await startStreamableHttp({ host, port, path });
  const address = running.address;
  console.error(`handrail-mcp listening on http://${address.address}:${address.port}${path}`);
  return running;
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().then((running) => {
    if (!running) return;
    const shutdown = async () => {
      await running.close();
      process.exitCode = 0;
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
