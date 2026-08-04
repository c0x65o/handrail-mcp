import { API_CONTRACT_VERSION } from "./version.js";
import { ContractVersionError } from "./errors.js";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function value(overrides, camel, snake, env, envName) {
  return overrides[camel] ?? overrides[snake] ?? env[envName];
}

function optionalString(input) {
  const normalized = String(input ?? "").trim();
  return normalized || undefined;
}

function positiveInteger(input, fallback, { min = 0, max = 120_000 } = {}) {
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed >= min ? Math.min(parsed, max) : fallback;
}

function apiUrl(input) {
  if (!input) return undefined;
  try {
    const parsed = new URL(input);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) return undefined;
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export function resolveConfig(overrides = {}, env = process.env) {
  const enabledRequested = overrides.enabled === true || TRUE_VALUES.has(String(env.HANDRAIL_ASSISTANT_BRIDGE_ENABLED || "").toLowerCase());
  const version = optionalString(value(overrides, "contractVersion", "contract_version", env, "HANDRAIL_ASSISTANT_BRIDGE_VERSION"));
  if (enabledRequested && version && version !== API_CONTRACT_VERSION) {
    throw new ContractVersionError(version, API_CONTRACT_VERSION);
  }

  const rawApiUrl = value(overrides, "apiUrl", "api_url", env, "HANDRAIL_ASSISTANT_BRIDGE_API_URL");
  const resolved = {
    enabledRequested,
    apiUrl: apiUrl(rawApiUrl),
    contractVersion: version,
    projectId: optionalString(value(overrides, "projectId", "project_id", env, "HANDRAIL_ASSISTANT_BRIDGE_PROJECT_ID")),
    capabilityId: optionalString(value(overrides, "capabilityId", "capability_id", env, "HANDRAIL_ASSISTANT_BRIDGE_CAPABILITY_ID")),
    token: optionalString(value(overrides, "token", "token", env, "HANDRAIL_ASSISTANT_BRIDGE_TOKEN")),
    sessionToken: optionalString(overrides.sessionToken ?? overrides.applicationSessionToken),
    issuer: optionalString(value(overrides, "issuer", "issuer", env, "HANDRAIL_ASSISTANT_PRINCIPAL_ISSUER")),
    subject: optionalString(value(overrides, "subject", "subject", env, "HANDRAIL_ASSISTANT_PRINCIPAL_SUBJECT")),
    requestTimeoutMs: positiveInteger(overrides.requestTimeoutMs ?? env.HANDRAIL_MCP_REQUEST_TIMEOUT_MS, 10_000, { min: 100 }),
    maxRetries: positiveInteger(overrides.maxRetries ?? env.HANDRAIL_MCP_MAX_RETRIES, 2, { max: 5 }),
    retryBaseDelayMs: positiveInteger(overrides.retryBaseDelayMs ?? env.HANDRAIL_MCP_RETRY_BASE_DELAY_MS, 100, { max: 10_000 }),
    retryMaxDelayMs: positiveInteger(overrides.retryMaxDelayMs ?? env.HANDRAIL_MCP_RETRY_MAX_DELAY_MS, 1_000, { max: 30_000 }),
    fetch: overrides.fetch,
  };
  const required = ["apiUrl", "contractVersion", "projectId", "capabilityId", "token"];
  const missingConfig = required.filter((key) => !resolved[key]);
  if (!resolved.sessionToken && (!resolved.issuer || !resolved.subject)) missingConfig.push("known_user_session");
  let disabledReason = null;
  if (!enabledRequested) disabledReason = "disabled";
  else if (!resolved.apiUrl) disabledReason = rawApiUrl ? "invalid_api_url" : "missing_api_url";
  else if (missingConfig.length) disabledReason = "incomplete_config";
  return Object.freeze({ ...resolved, enabled: enabledRequested && disabledReason === null, disabledReason, missingConfig: Object.freeze(missingConfig) });
}

export function publicConfig(config) {
  return Object.freeze({
    enabled: config.enabled,
    disabled_reason: config.disabledReason,
    missing_config: [...config.missingConfig],
    api_url: config.apiUrl,
    contract_version: config.contractVersion,
    project_id: config.projectId,
    capability_id: config.capabilityId,
    principal: config.sessionToken
      ? { source: "known_user_session" }
      : config.issuer && config.subject ? { issuer: config.issuer, subject: config.subject, source: "legacy_static" } : null,
    credential_configured: Boolean(config.token),
    request_timeout_ms: config.requestTimeoutMs,
    max_retries: config.maxRetries,
  });
}
