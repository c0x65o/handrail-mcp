import * as z from "zod/v4";

const nullableString = z.string().nullable().optional();
const requestId = { request_id: z.string().min(1).max(160) };

export const TOOL_NAMES = Object.freeze({
  discover: "handrail_developer_change_v1_discover",
  submit: "handrail_developer_change_v1_submit",
  list: "handrail_developer_change_v1_list",
  lookup: "handrail_developer_change_v1_lookup",
  releaseStatus: "handrail_developer_change_v1_release_status",
  dismiss: "handrail_developer_change_v1_dismiss",
  clarify: "handrail_developer_change_v1_clarify",
  cancel: "handrail_developer_change_v1_cancel",
});

export const TOOL_SCHEMAS = Object.freeze({
  discover: {},
  submit: {
    idempotency_key: z.string().min(1).max(255).describe("Stable identity for exactly one change intent. Use a new key for each separate request, including while earlier requests are pending or running; reuse only for an exact retry. Prefer external_conversation_id:user_message_id (or another durable per-intent ID)."),
    external_conversation_id: z.string().min(1).max(512).describe("Durable conversation identifier used to group requests for traceability. It is not an idempotency key, and many simultaneous requests may share it."),
    requested_delivery_ceiling: z.enum(["work_request", "staging", "production"]),
    title: z.string().min(1).max(500),
    description: nullableString,
    priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
    category: z.enum(["task", "feature"]).nullable().optional(),
    run_codex: z.boolean().nullable().optional(),
    ci_cd: z.boolean().nullable().optional(),
    target_check_ids: z.array(z.string().min(1).max(160)).max(100).nullable().optional(),
    auto_commit_push: z.boolean().nullable().optional(),
    auto_deploy_env: z.enum(["staging", "production"]).nullable().optional(),
  },
  list: {
    limit: z.number().int().min(1).max(50).nullable().optional(),
    offset: z.number().int().min(0).max(10_000).nullable().optional(),
  },
  lookup: requestId,
  releaseStatus: requestId,
  dismiss: requestId,
  clarify: {
    ...requestId,
    response: z.string().min(1).max(20_000),
    title: nullableString,
    description: nullableString,
  },
  cancel: {
    ...requestId,
    reason: nullableString,
  },
});

export const TOOL_DEFINITIONS = Object.freeze([
  {
    operation: "discover",
    name: TOOL_NAMES.discover,
    title: "Discover Handrail policy",
    description: "Report connector/API versions plus the central principal authentication state, resolved access level, and default-deny capability policy.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    operation: "submit",
    name: TOOL_NAMES.submit,
    title: "Submit a developer Work Request",
    description: "Submit one idempotent developer-oriented canonical Work Request. This tool is not customer bug or enhancement intake. Multiple requests may be pending or running at once: use a new idempotency_key for every distinct change intent, even in the same conversation, and reuse a key only for an exact retry.",
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    operation: "list",
    name: TOOL_NAMES.list,
    title: "List Handrail changes",
    description: "List developer-oriented durable change requests owned by this bound principal. Customer feedback uses the reporter tools.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    operation: "lookup",
    name: TOOL_NAMES.lookup,
    title: "Look up Handrail status",
    description: "Look up and monitor durable status, linked Work Request state, and evidence for a change owned by this bound principal. When several requests are active, call this tool separately with each request.id returned by submit.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    operation: "releaseStatus",
    name: TOOL_NAMES.releaseStatus,
    title: "Track a Handrail release",
    description: "Report the full auto-commit SHA and version, deployments of that change including later manual deployments, and the version currently deployed on every configured environment target.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    operation: "dismiss",
    name: TOOL_NAMES.dismiss,
    title: "Dismiss a Handrail history item",
    description: "Hide an enhancement from this principal's default request history without deleting or cancelling the canonical request or its linked Work Request.",
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    operation: "clarify",
    name: TOOL_NAMES.clarify,
    title: "Clarify a Handrail change",
    description: "Append a clarification to a non-terminal change and let the central lifecycle resume it.",
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    operation: "cancel",
    name: TOOL_NAMES.cancel,
    title: "Safely cancel a Handrail change",
    description: "Request safe cancellation without deleting accepted PM records or bypassing central lifecycle rules.",
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
  },
]);
