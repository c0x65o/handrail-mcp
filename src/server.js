import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { HandrailClient } from "./client.js";
import { redact } from "./errors.js";
import { TOOL_DEFINITIONS, TOOL_SCHEMAS } from "./schemas.js";
import { API_CONTRACT_VERSION, CONNECTOR_NAME, CONNECTOR_VERSION, versionMetadata } from "./version.js";

function unique(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = item?.[key];
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function centralResources(discovery) {
  const declared = [
    ...(Array.isArray(discovery.resources) ? discovery.resources : []),
    ...(Array.isArray(discovery.capability?.resources) ? discovery.capability.resources : []),
  ];
  const kbResources = (discovery.capability?.kb_slugs || []).map((slug) => ({
    slug,
    name: slug,
    title: slug,
    uri: `handrail://knowledge-base/${encodeURIComponent(slug)}`,
    mime_type: "text/markdown",
    read_path: `resources/knowledge-base/${encodeURIComponent(slug)}`,
    description: "Handrail Knowledge Base content fetched from the central API.",
  }));
  return unique([...declared, ...kbResources], "uri");
}

function centralPrompts(discovery) {
  return unique(Array.isArray(discovery.prompts) ? discovery.prompts : [], "name");
}

function toolResult(operation, payload) {
  const result = redact({
    ...payload,
    connector: versionMetadata(),
  });
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
    _meta: { operation, ...versionMetadata() },
  };
}

function toolError(error) {
  const safe = redact(error?.toJSON?.() || {
    error: error?.message || "Handrail connector request failed",
    code: error?.code || "handrail_connector_error",
    status: error?.status,
  });
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(safe) }],
  };
}

function promptArgsSchema(descriptor) {
  const fields = Array.isArray(descriptor.arguments) ? descriptor.arguments : [];
  return Object.fromEntries(fields.map((field) => {
    let schema = z.string().describe(field.description || field.name);
    if (field.required !== true) schema = schema.optional();
    return [field.name, schema];
  }));
}

function resourceContents(descriptor, response) {
  if (Array.isArray(response?.contents)) {
    return response.contents.map((entry) => ({
      uri: entry.uri || descriptor.uri,
      mimeType: entry.mimeType || entry.mime_type || descriptor.mime_type || "text/markdown",
      ...(entry.blob ? { blob: entry.blob } : { text: String(entry.text ?? entry.content ?? "") }),
    }));
  }
  return [{
    uri: descriptor.uri,
    mimeType: response?.mime_type || descriptor.mime_type || "text/markdown",
    text: String(response?.text ?? response?.content ?? ""),
  }];
}

function promptMessages(response) {
  if (!Array.isArray(response?.messages)) throw new Error("Central prompt response did not contain messages.");
  return response.messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content && typeof message.content === "object"
      ? message.content
      : { type: "text", text: String(message.content ?? "") },
  }));
}

export async function createConnectorServer(options = {}) {
  const client = options.client || new HandrailClient(options.config, options.env);
  const config = client.getConfig();
  const discovery = config.enabled ? (options.discovery || await client.discover()) : null;
  const server = new McpServer({
    name: CONNECTOR_NAME,
    version: CONNECTOR_VERSION,
    title: "Handrail MCP Connector",
  });

  // The SDK installs list handlers lazily on first registration. Disabled
  // placeholders keep standards-compliant empty list responses in default-deny
  // mode without exposing a callable surface.
  server.registerTool("_handrail_disabled", { inputSchema: {} }, async () => ({ content: [] })).disable();
  server.registerResource("_handrail_disabled", "handrail://disabled", {}, async () => ({ contents: [] })).disable();
  server.registerPrompt("_handrail_disabled", {}, async () => ({ messages: [] })).disable();

  if (!config.enabled) return { server, client, discovery: null, config };

  const operations = new Set(discovery.operations || []);
  for (const definition of TOOL_DEFINITIONS) {
    if (!operations.has(definition.operation)) continue;
    server.registerTool(definition.name, {
      title: definition.title,
      description: definition.description,
      inputSchema: TOOL_SCHEMAS[definition.operation],
      annotations: definition.annotations,
      _meta: versionMetadata(),
    }, async (args) => {
      try {
        const result = await client[definition.operation](args);
        return toolResult(definition.operation, result);
      } catch (error) {
        return toolError(error);
      }
    });
  }

  for (const descriptor of centralResources(discovery)) {
    server.registerResource(descriptor.name || descriptor.slug, descriptor.uri, {
      title: descriptor.title || descriptor.name || descriptor.slug,
      description: descriptor.description,
      mimeType: descriptor.mime_type || descriptor.mimeType || "text/markdown",
      _meta: { source: "central_handrail_api", api_contract_version: API_CONTRACT_VERSION },
    }, async () => ({ contents: resourceContents(descriptor, await client.readResource(descriptor)) }));
  }

  for (const descriptor of centralPrompts(discovery)) {
    server.registerPrompt(descriptor.name, {
      title: descriptor.title || descriptor.name,
      description: descriptor.description,
      argsSchema: promptArgsSchema(descriptor),
    }, async (args) => {
      const response = await client.getPrompt(descriptor, args);
      return { messages: promptMessages(response) };
    });
  }

  return { server, client, discovery, config };
}

export const __testing = Object.freeze({ centralResources, centralPrompts, resourceContents, promptMessages });
