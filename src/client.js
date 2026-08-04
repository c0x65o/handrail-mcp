import { API_CONTRACT_VERSION, CONNECTOR_VERSION } from "./version.js";
import { publicConfig, resolveConfig } from "./config.js";
import { ContractVersionError, HandrailApiError, redact } from "./errors.js";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const REQUEST_STATUSES = new Set([
  "pending",
  "needs_clarification",
  "accepted",
  "running",
  "needs_attention",
  "succeeded",
  "cancelled",
  "failed",
]);
const TERMINAL_STATUSES = new Set(["accepted", "succeeded", "cancelled", "failed"]);

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function jsonOrText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2_000);
  }
}

function redactCredential(value, credential, seen = new WeakSet()) {
  if (!credential) return value;
  if (typeof value === "string") return value.split(credential).join("[REDACTED]");
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[TRUNCATED]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactCredential(item, credential, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactCredential(item, credential, seen)]));
}

function errorMessage(payload, status) {
  const message = payload && typeof payload === "object" ? payload.error || payload.message : null;
  return typeof message === "string" && message.trim()
    ? message.trim().slice(0, 1_000)
    : `Handrail API request failed with status ${status || "unknown"}.`;
}

function responseContractVersion(payload) {
  if (!payload || typeof payload !== "object") return null;
  return payload.contract_version || payload.request?.contract_version || null;
}

function assertContract(payload, { requireVersion = true } = {}) {
  const received = responseContractVersion(payload);
  if (requireVersion && received !== API_CONTRACT_VERSION) throw new ContractVersionError(received, API_CONTRACT_VERSION);
  if (received && received !== API_CONTRACT_VERSION) throw new ContractVersionError(received, API_CONTRACT_VERSION);
  const request = payload?.request && typeof payload.request === "object" ? payload.request : payload;
  if (!request || typeof request !== "object" || !Object.hasOwn(request, "status")) return payload;
  if (!REQUEST_STATUSES.has(request.status)) {
    throw new HandrailApiError("Handrail returned an unknown durable request status.", {
      code: "assistant_bridge_contract_mismatch",
      response: payload,
    });
  }
  const expectedTerminal = TERMINAL_STATUSES.has(request.status);
  if (typeof request.terminal !== "boolean" || request.terminal !== expectedTerminal) {
    throw new HandrailApiError("Handrail returned inconsistent durable terminal status.", {
      code: "assistant_bridge_contract_mismatch",
      response: payload,
    });
  }
  return payload;
}

function descriptorPath(descriptor, kind) {
  return descriptor.read_path || descriptor.path || descriptor.href || `${kind}/${encodeURIComponent(descriptor.slug || descriptor.name)}`;
}

export class HandrailClient {
  #token;
  #fetch;
  #config;

  constructor(options = {}, env = process.env) {
    this.#config = resolveConfig(options, env);
    this.#token = this.#config.token;
    this.#fetch = this.#config.fetch || globalThis.fetch;
  }

  isEnabled() {
    return this.#config.enabled;
  }

  getConfig() {
    return publicConfig(this.#config);
  }

  async discover() {
    if (!this.isEnabled()) return null;
    return this.#request("discovery", { method: "GET", retrySafe: true });
  }

  async submit(input) {
    if (!this.isEnabled()) return null;
    const payload = compact({ ...input });
    return this.#request("requests", {
      method: "POST",
      payload,
      idempotencyKey: input.idempotency_key,
      retrySafe: true,
    });
  }

  async lookup({ request_id }) {
    if (!this.isEnabled()) return null;
    return this.#request(`requests/${encodeURIComponent(request_id)}`, { method: "GET", retrySafe: true });
  }

  async clarify({ request_id, ...input }) {
    if (!this.isEnabled()) return null;
    return this.#request(`requests/${encodeURIComponent(request_id)}/clarifications`, {
      method: "POST",
      payload: compact(input),
      retrySafe: false,
    });
  }

  async cancel({ request_id, ...input }) {
    if (!this.isEnabled()) return null;
    return this.#request(`requests/${encodeURIComponent(request_id)}/cancel`, {
      method: "POST",
      payload: compact(input),
      retrySafe: true,
    });
  }

  async readResource(descriptor) {
    if (!this.isEnabled()) return null;
    return this.#request(descriptorPath(descriptor, "resources"), { method: "GET", retrySafe: true });
  }

  async getPrompt(descriptor, args = {}) {
    if (!this.isEnabled()) return null;
    return this.#request(descriptorPath(descriptor, "prompts"), {
      method: "POST",
      payload: { arguments: args },
      retrySafe: false,
    });
  }

  #url(path) {
    const base = new URL(`${this.#config.apiUrl}/`);
    const resolved = new URL(String(path).replace(/^\/+/, ""), base);
    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    if (resolved.origin !== base.origin || !resolved.pathname.startsWith(basePath)) {
      throw new HandrailApiError("Central discovery advertised an endpoint outside the bound Handrail API.", {
        code: "assistant_bridge_endpoint_scope_denied",
      });
    }
    return resolved.toString();
  }

  async #request(path, { method, payload, idempotencyKey, retrySafe }) {
    if (typeof this.#fetch !== "function") {
      throw new HandrailApiError("A server-side fetch implementation is required.", { code: "assistant_bridge_fetch_unavailable" });
    }
    const headers = {
      accept: "application/json",
      authorization: `Bearer ${this.#token}`,
      "x-handrail-principal-issuer": this.#config.issuer,
      "x-handrail-principal-subject": this.#config.subject,
      "x-handrail-connector-version": CONNECTOR_VERSION,
      "x-handrail-api-contract-version": API_CONTRACT_VERSION,
    };
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

    const attempts = retrySafe ? this.#config.maxRetries + 1 : 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#config.requestTimeoutMs);
      try {
        const response = await this.#fetch(this.#url(path), { method, headers, body, signal: controller.signal });
        const responsePayload = redactCredential(jsonOrText(await response.text()), this.#token);
        if (!response.ok) {
          const status = Number(response.status) || undefined;
          const error = new HandrailApiError(errorMessage(responsePayload, status), {
            code: responsePayload?.code || "assistant_bridge_http_error",
            status,
            retryable: RETRYABLE_STATUS.has(status),
            response: responsePayload,
          });
          if (!error.retryable || attempt + 1 >= attempts) throw error;
          lastError = error;
          await this.#retryDelay(attempt, response);
          continue;
        }
        return assertContract(responsePayload);
      } catch (error) {
        if (error instanceof HandrailApiError) throw error;
        lastError = new HandrailApiError("Handrail API request failed.", {
          code: error?.name === "AbortError" ? "assistant_bridge_timeout" : "assistant_bridge_network_error",
          retryable: true,
          cause: error,
        });
        if (attempt + 1 >= attempts) throw lastError;
        await this.#retryDelay(attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async #retryDelay(attempt, response) {
    const header = response?.headers?.get?.("retry-after");
    const retryAfter = header ? Number(header) * 1_000 : Number.NaN;
    const exponential = Math.min(this.#config.retryMaxDelayMs, this.#config.retryBaseDelayMs * (2 ** attempt));
    const delay = Number.isFinite(retryAfter) && retryAfter >= 0
      ? Math.min(retryAfter, this.#config.retryMaxDelayMs)
      : exponential;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

export function createHandrailClient(options, env) {
  return new HandrailClient(options, env);
}

export const __testing = Object.freeze({ assertContract, redact });
