import * as z from "zod/v4";

const requestId = { request_id: z.string().min(1).max(160) };
const subscription = {
  ...requestId,
  reporter_notification: z.strictObject({
    notify_on_resolution: z.literal(true).describe("Explicit user consent to email when this report is fixed. Never infer consent."),
    consent_version: z.string().trim().min(1).max(40).optional(),
  }),
};
const history = {
  limit: z.number().int().min(1).max(50).optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(["newest", "oldest"]).optional(),
};

export const FEEDBACK_TOOL_NAMES = Object.freeze({
  discover: "handrail_feedback_v2_discover",
  bugSubmit: "handrail_bug_reporter_v1_submit",
  bugList: "handrail_bug_reporter_v1_list",
  bugLookup: "handrail_bug_reporter_v1_lookup",
  bugArchive: "handrail_bug_reporter_v1_archive",
  bugRestore: "handrail_bug_reporter_v1_restore",
  bugSubscribe: "handrail_bug_reporter_v1_subscribe",
  enhancementSubmit: "handrail_enhancement_reporter_v1_submit",
  enhancementList: "handrail_enhancement_reporter_v1_list",
  enhancementLookup: "handrail_enhancement_reporter_v1_lookup",
  enhancementReleaseStatus: "handrail_enhancement_reporter_v1_release_status",
  enhancementArchive: "handrail_enhancement_reporter_v1_archive",
  enhancementRestore: "handrail_enhancement_reporter_v1_restore",
  enhancementCancel: "handrail_enhancement_reporter_v1_cancel",
  enhancementClarify: "handrail_enhancement_reporter_v1_clarify",
  enhancementSubscribe: "handrail_enhancement_reporter_v1_subscribe",
});

export const DEVELOPER_TOOL_NAMES = Object.freeze({
  discover: "handrail_developer_change_v1_discover",
  submit: "handrail_developer_change_v1_submit",
  list: "handrail_developer_change_v1_list",
  lookup: "handrail_developer_change_v1_lookup",
  releaseStatus: "handrail_developer_change_v1_release_status",
  dismiss: "handrail_developer_change_v1_dismiss",
  clarify: "handrail_developer_change_v1_clarify",
  cancel: "handrail_developer_change_v1_cancel",
});

export const FEEDBACK_TOOL_DEFINITIONS = Object.freeze([
  { surface: "feedback", operation: "discover", name: FEEDBACK_TOOL_NAMES.discover, title: "Discover Handrail feedback transports", description: "Report whether the independent bug and enhancement transports are exactly configured, session-authenticated, and accepted by their canonical Handrail discovery endpoints.", schema: {}, readOnly: true },
  { surface: "bug", operation: "submit", name: FEEDBACK_TOOL_NAMES.bugSubmit, title: "Report a Handrail bug", description: "Create or deduplicate a canonical Handrail PM bug through the configured bug reporter. This never creates an Assistant Bridge request or directly grants implementation or deployment authority.", schema: {
    title: z.string().min(1).max(240),
    description: z.string().min(1).max(8_000),
    impact: z.enum(["critical", "high", "moderate", "low"]).optional(),
    reproducer: z.string().max(8_000).optional(),
    route: z.string().max(500).optional(),
    app_version: z.string().max(120).optional(),
    event_id: z.string().min(8).max(160).describe("Stable identity for this exact report intent. Reuse it only for an exact retry so canonical bug intake deduplicates the submission."),
  } },
  { surface: "bug", operation: "list", name: FEEDBACK_TOOL_NAMES.bugList, title: "List my Handrail bugs", description: "List canonical bugs owned by the current verified Known User.", schema: { ...history, cursor: z.string().max(4_000).optional(), status_group: z.enum(["needs_attention", "in_progress", "closed", "not_reproduced"]).optional(), visibility: z.enum(["active", "archived", "all"]).optional() }, readOnly: true },
  { surface: "bug", operation: "lookup", name: FEEDBACK_TOOL_NAMES.bugLookup, title: "Look up my Handrail bug", description: "Read one canonical bug owned by the current verified Known User.", schema: requestId, readOnly: true },
  { surface: "bug", operation: "archive", name: FEEDBACK_TOOL_NAMES.bugArchive, title: "Archive my Handrail bug", description: "Hide a bug from this principal's active history without deleting or changing the canonical bug.", schema: requestId },
  { surface: "bug", operation: "restore", name: FEEDBACK_TOOL_NAMES.bugRestore, title: "Restore my Handrail bug", description: "Restore a principal-scoped archived bug history item.", schema: requestId },
  { surface: "bug", operation: "subscribe", name: FEEDBACK_TOOL_NAMES.bugSubscribe, title: "Subscribe to my Handrail bug", description: "With explicit consent, subscribe the verified Known User's configured email to the canonical fixed notification. Returns consent status, not delivery readiness or background authorization.", schema: subscription, strict: true },
  { surface: "enhancement", operation: "submit", name: FEEDBACK_TOOL_NAMES.enhancementSubmit, title: "Suggest a Handrail enhancement", description: "Create a first-class PM enhancement and its read-only assessment through Enhancement Reporting. The submission contains no implementation, Codex, CI, commit, or deployment controls.", schema: {
    idempotency_key: z.string().min(1).max(255),
    external_conversation_id: z.string().min(1).max(512),
    title: z.string().min(1).max(300),
    description: z.string().min(1).max(20_000),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    context: z.object({ route: z.string().max(2_000).optional(), page_title: z.string().max(500).optional(), app_version: z.string().max(160).optional(), viewport: z.string().max(80).optional() }).optional(),
  } },
  { surface: "enhancement", operation: "list", name: FEEDBACK_TOOL_NAMES.enhancementList, title: "List my Handrail enhancements", description: "List first-class enhancements owned by the current verified Known User.", schema: { ...history, offset: z.number().int().min(0).max(10_000).optional(), status_group: z.enum(["needs_attention", "in_progress", "succeeded", "closed"]).optional(), visibility: z.enum(["active", "dismissed", "all"]).optional() }, readOnly: true },
  { surface: "enhancement", operation: "lookup", name: FEEDBACK_TOOL_NAMES.enhancementLookup, title: "Look up my Handrail enhancement", description: "Read one first-class enhancement owned by the current verified Known User.", schema: requestId, readOnly: true },
  { surface: "enhancement", operation: "releaseStatus", name: FEEDBACK_TOOL_NAMES.enhancementReleaseStatus, title: "Track an enhancement release", description: "Read release evidence for a first-class enhancement owned by the current verified Known User.", schema: requestId, readOnly: true },
  { surface: "enhancement", operation: "archive", name: FEEDBACK_TOOL_NAMES.enhancementArchive, title: "Archive my Handrail enhancement", description: "Hide an enhancement from this principal's active history without changing its canonical lifecycle.", schema: requestId },
  { surface: "enhancement", operation: "restore", name: FEEDBACK_TOOL_NAMES.enhancementRestore, title: "Restore my Handrail enhancement", description: "Restore a principal-scoped enhancement history item.", schema: requestId },
  { surface: "enhancement", operation: "cancel", name: FEEDBACK_TOOL_NAMES.enhancementCancel, title: "Cancel my Handrail enhancement", description: "Request safe cancellation before implementation without deleting the canonical enhancement.", schema: { ...requestId, reason: z.string().max(2_000).optional() } },
  { surface: "enhancement", operation: "clarify", name: FEEDBACK_TOOL_NAMES.enhancementClarify, title: "Answer my enhancement clarification", description: "Answer the current clarification returned by enhancement lookup, using its assessment_id and assessment_version when response_allowed is true. Exact retries preserve that tuple and answer. This supplies product input, never staff implementation approval. On stale/conflict refresh lookup; never invent a new assessment identity.", schema: {
    ...requestId,
    assessment_id: z.string().min(1).refine((value) => value.trim().length > 0, "Assessment ID must not be blank"),
    assessment_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    answer: z.string().min(1).max(4_000).refine((value) => value.trim().length > 0, "Answer must not be blank"),
  }, strict: true },
  { surface: "enhancement", operation: "subscribe", name: FEEDBACK_TOOL_NAMES.enhancementSubscribe, title: "Subscribe to my Handrail enhancement", description: "With explicit consent, subscribe the verified Known User's configured email to the canonical fixed notification. Returns consent status, not delivery readiness or background authorization.", schema: subscription, strict: true },
]);
