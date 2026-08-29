import { HandrailApiError } from "./errors.js";
import { CONNECTOR_NAME, CONNECTOR_VERSION } from "./version.js";

const APPLICATION_SESSION_TOKEN_HEADER = "x-handrail-application-session-token";
const ENHANCEMENT_SESSION_HEADER = "x-handrail-application-session";
const REQUEST_TIMEOUT_MS = 10_000;

function clean(value, maximum = 20_000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function safeErrorCode(value, fallback) {
  const code = clean(value, 120);
  return code && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(code) ? code : fallback;
}

function apiUrl(value, label) {
  try {
    const parsed = new URL(clean(value, 2_000));
    if (
      !["http:", "https:"].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) throw new Error("invalid URL");
    return parsed;
  } catch {
    throw new HandrailApiError(`${label} URL is invalid.`, {
      code: "feedback_transport_invalid_configuration",
      status: 500,
    });
  }
}

function scopedUrl(baseUrl, path) {
  const base = new URL(baseUrl.toString());
  base.pathname = `${base.pathname.replace(/\/+$/u, "")}/`;
  const resolved = new URL(String(path).replace(/^\/+/, ""), base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
    throw new HandrailApiError("Feedback transport path is outside its configured API scope.", {
      code: "feedback_transport_scope_denied",
      status: 500,
    });
  }
  return resolved;
}

function withQuery(url, values) {
  const result = new URL(url.toString());
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && String(value).length > 0) {
      result.searchParams.set(key, String(value));
    }
  }
  return result;
}

async function requestJson(fetchImpl, url, init, { contractVersion = null } = {}) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url.toString(), { ...init, signal: controller.signal });
  } catch (error) {
    throw new HandrailApiError(
      error instanceof Error && error.name === "AbortError"
        ? "The Handrail feedback request timed out."
        : "The Handrail feedback request failed.",
      {
        code: error instanceof Error && error.name === "AbortError"
          ? "feedback_transport_timeout"
          : "feedback_transport_network_error",
        status: 502,
        cause: error,
      },
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }

  let body = null;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new HandrailApiError("Handrail rejected the feedback request.", {
      code: safeErrorCode(
        object(body?.error)?.code || body?.code,
        "feedback_transport_http_error",
      ),
      status: response.status,
    });
  }
  if (contractVersion) {
    const received = clean(body?.contract_version || body?.request?.contract_version, 40);
    if (received !== contractVersion) {
      throw new HandrailApiError("Handrail returned an incompatible feedback response.", {
        code: "feedback_transport_contract_mismatch",
        status: 502,
      });
    }
  }
  return { body, status: response.status };
}

function bugReportsUrl(value) {
  const url = apiUrl(value, "Bug reporting API");
  const path = url.pathname.replace(/\/{2,}/gu, "/").replace(/\/+$/u, "");
  if (path.endsWith("/api/mobile-bug-reports")) url.pathname = path;
  else if (path.endsWith("/api")) url.pathname = `${path}/mobile-bug-reports`;
  else url.pathname = `${path}/api/mobile-bug-reports`.replace(/^\/\//u, "/");
  return url;
}

function bugIdentity() {
  return {
    source: "node_web_bug_reporter",
    platform: "node",
    reporter_sdk_runtime: "node",
    reporter_sdk_package: CONNECTOR_NAME,
    reporter_sdk_version: CONNECTOR_VERSION,
  };
}

export function createBugFeedbackClient(config) {
  const reports = bugReportsUrl(config.apiBaseUrl);
  const fetchImpl = config.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new HandrailApiError("A fetch implementation is required.", {
      code: "feedback_transport_invalid_configuration",
      status: 500,
    });
  }
  const headers = (body = false) => ({
    accept: "application/json",
    authorization: `Bearer ${config.reportToken}`,
    [APPLICATION_SESSION_TOKEN_HEADER]: config.sessionToken,
    ...(body ? { "content-type": "application/json" } : {}),
  });
  const request = (url, { method = "GET", payload } = {}) => requestJson(fetchImpl, url, {
    method,
    headers: headers(payload !== undefined),
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  const ownedUrl = (path, values = {}) => withQuery(
    new URL(path, `${reports.toString().replace(/\/+$/u, "")}/`),
    {
      project_id: config.projectId,
      environment: config.environment,
      ...values,
    },
  );

  return Object.freeze({
    async discoverPolicy() {
      const { body } = await request(ownedUrl("policy"));
      const reporter = object(body?.reporter);
      if (body?.schema_version !== 1 || !reporter) return null;
      return {
        schemaVersion: 1,
        projectId: body.project_id,
        environment: clean(body.environment, 100).toLowerCase(),
        identityVerified: reporter.identity_verified === true,
        accessLevel: clean(reporter.access_level, 80) || null,
        role: clean(reporter.role, 80) || null,
        askOptions: Array.isArray(body.ask_options) ? body.ask_options : [],
      };
    },
    async submit(input) {
      const payload = {
        title: input.title,
        description: input.description,
        severity: input.impact,
        reproducer: input.reproducer,
        route: input.route,
        app_version: input.appVersion,
        event_id: input.eventId,
        project_id: config.projectId,
        environment: config.environment,
        ...bugIdentity(),
      };
      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined) delete payload[key];
      }
      const { body, status } = await request(reports, { method: "POST", payload });
      return {
        status: "submitted",
        statusCode: status,
        bugId: clean(body?.bug_id, 160) || null,
        response: body,
      };
    },
    async listBugs(input = {}) {
      return (await request(ownedUrl("mine", {
        limit: input.limit,
        cursor: input.cursor,
        search: input.search,
        status_group: input.statusGroup,
        sort: input.sort,
        visibility: input.visibility,
      }))).body;
    },
    async getBug(requestId) {
      const body = (await request(ownedUrl(`bugs/${encodeURIComponent(requestId)}`))).body;
      return body?.bug || body;
    },
    async archiveBug(requestId) {
      return (await request(ownedUrl(`bugs/${encodeURIComponent(requestId)}/archive`), { method: "PUT" })).body;
    },
    async restoreBug(requestId) {
      return (await request(ownedUrl(`bugs/${encodeURIComponent(requestId)}/archive`), { method: "DELETE" })).body;
    },
  });
}

function enhancementIdentity() {
  return {
    package: CONNECTOR_NAME,
    version: CONNECTOR_VERSION,
    runtime: "node",
  };
}

export function createEnhancementFeedbackClient(config) {
  const baseUrl = apiUrl(config.apiUrl, "Enhancement reporting API");
  const fetchImpl = config.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new HandrailApiError("A fetch implementation is required.", {
      code: "feedback_transport_invalid_configuration",
      status: 500,
    });
  }
  const headers = (body = false, idempotencyKey = null) => ({
    accept: "application/json",
    authorization: `Bearer ${config.token}`,
    "x-handrail-api-contract-version": config.contractVersion,
    [ENHANCEMENT_SESSION_HEADER]: config.sessionToken,
    ...(body ? { "content-type": "application/json" } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
  });
  const request = (path, { method = "GET", payload, idempotencyKey = null } = {}) => requestJson(
    fetchImpl,
    scopedUrl(baseUrl, path),
    {
      method,
      headers: headers(payload !== undefined, idempotencyKey),
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    },
    { contractVersion: config.contractVersion },
  ).then(({ body }) => body);

  return Object.freeze({
    discover: () => request("discovery"),
    submit: (input) => request("requests", {
      method: "POST",
      payload: { ...input, reporter_sdk: enhancementIdentity() },
      idempotencyKey: clean(input.idempotency_key, 255) || null,
    }),
    list: (input = {}) => {
      const query = new globalThis.URLSearchParams();
      if (input.submission_kind) query.set("submission_kind", String(input.submission_kind));
      if (input.limit != null) query.set("limit", String(input.limit));
      if (input.offset != null) query.set("offset", String(input.offset));
      if (input.search) query.set("search", String(input.search));
      if (input.status_group || input.statusGroup) query.set("status_group", String(input.status_group || input.statusGroup));
      if (input.sort) query.set("sort", String(input.sort));
      if (input.visibility) query.set("visibility", String(input.visibility));
      return request(`requests${query.size ? `?${query.toString()}` : ""}`);
    },
    lookup: ({ request_id: requestId }) => request(`requests/${encodeURIComponent(requestId)}`),
    releaseStatus: ({ request_id: requestId }) => request(`requests/${encodeURIComponent(requestId)}/release-status`),
    dismiss: ({ request_id: requestId }) => request(`requests/${encodeURIComponent(requestId)}/dismiss`, { method: "POST", payload: {} }),
    restore: ({ request_id: requestId }) => request(`requests/${encodeURIComponent(requestId)}/dismiss`, { method: "DELETE" }),
    cancel: ({ request_id: requestId, reason }) => request(`requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST", payload: { reason: reason || null } }),
  });
}
