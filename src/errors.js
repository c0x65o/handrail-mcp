const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|credential|private[-_]?key|api[-_]?key)/i;

export function redact(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 2_000);
  if (depth >= 6) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, depth + 1, seen));
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return "[TRUNCATED]";
  seen.add(value);
  return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item, depth + 1, seen),
  ]));
}

export class HandrailApiError extends Error {
  constructor(message, { code = "handrail_api_error", status, retryable = false, response, cause } = {}) {
    super(message, { cause });
    this.name = "HandrailApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (response !== undefined) this.response = redact(response);
  }

  toJSON() {
    return redact({ name: this.name, message: this.message, code: this.code, status: this.status, retryable: this.retryable, response: this.response });
  }
}

export class ContractVersionError extends HandrailApiError {
  constructor(received, expected) {
    super(`Handrail API contract '${received || "missing"}' is incompatible with required contract '${expected}'.`, {
      code: "assistant_bridge_contract_version_incompatible",
      status: 409,
    });
    this.name = "ContractVersionError";
    this.received = received || null;
    this.expected = expected;
  }
}
