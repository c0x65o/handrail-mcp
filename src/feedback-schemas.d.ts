import type { ZodType } from "zod/v4";

/** Canonical reporter arguments. Identity and runtime credentials are host-owned. */
export interface FeedbackRequestInput { request_id: string }
export type FeedbackAnswerInput = FeedbackRequestInput & { information_request_id: string } &
  ({ option: string; answer?: string } | { option?: string; answer: string });
export type EnhancementClarificationInput = FeedbackAnswerInput;
export interface FeedbackSubscriptionInput extends FeedbackRequestInput {
  reporter_notification: {
    /** Explicit user consent is required. */
    notify_on_resolution: true;
    /** Nonblank, at most 40 characters; canonical default is v1. */
    consent_version?: string;
  };
}
export interface FeedbackSubscriptionResponse {
  notification_subscription: {
    active: true;
    created: boolean;
    recipient_hint: string;
    subscribed_at: string;
  };
}
export interface EnhancementSubscriptionResponse extends FeedbackSubscriptionResponse {
  contract_version: "v1";
}
export interface EnhancementClarificationResponse {
  contract_version: "v1";
  answered: true;
  replayed: boolean;
  /** Continuation assessment ID; do not reuse as an unanswered question ID. */
  assessment_id: string;
  assessment_status: string | null;
  warning: { code: string; message: string } | null;
  implementation_authority: false;
  deployment_authority: false;
}
export const FEEDBACK_TOOL_NAMES: Readonly<{
  discover: "handrail_feedback_v2_discover";
  bugAddAttachments: "handrail_bug_reporter_v1_add_attachments";
  bugListAttachments: "handrail_bug_reporter_v1_list_attachments";
  bugGetAttachment: "handrail_bug_reporter_v1_get_attachment";
  bugSubmit: "handrail_bug_reporter_v1_submit";
  bugList: "handrail_bug_reporter_v1_list";
  bugAnswer: "handrail_bug_reporter_v1_answer";
  bugLookup: "handrail_bug_reporter_v1_lookup";
  bugArchive: "handrail_bug_reporter_v1_archive";
  bugRestore: "handrail_bug_reporter_v1_restore";
  bugFollowUp: "handrail_bug_reporter_v1_follow_up";
  bugStopFollowUp: "handrail_bug_reporter_v1_stop_follow_up";
  bugSubscribe: "handrail_bug_reporter_v1_subscribe";
  enhancementAddAttachments: "handrail_enhancement_reporter_v1_add_attachments";
  enhancementListAttachments: "handrail_enhancement_reporter_v1_list_attachments";
  enhancementGetAttachment: "handrail_enhancement_reporter_v1_get_attachment";
  enhancementSubmit: "handrail_enhancement_reporter_v1_submit";
  enhancementList: "handrail_enhancement_reporter_v1_list";
  enhancementAnswer: "handrail_enhancement_reporter_v1_answer";
  enhancementLookup: "handrail_enhancement_reporter_v1_lookup";
  enhancementReleaseStatus: "handrail_enhancement_reporter_v1_release_status";
  enhancementArchive: "handrail_enhancement_reporter_v1_archive";
  enhancementRestore: "handrail_enhancement_reporter_v1_restore";
  enhancementCancel: "handrail_enhancement_reporter_v1_cancel";
  enhancementClarify: "handrail_enhancement_reporter_v1_clarify";
  enhancementFollowUp: "handrail_enhancement_reporter_v1_follow_up";
  enhancementStopFollowUp: "handrail_enhancement_reporter_v1_stop_follow_up";
  enhancementSubscribe: "handrail_enhancement_reporter_v1_subscribe";
}>;
export const DEVELOPER_TOOL_NAMES: Readonly<{
  discover: "handrail_developer_change_v1_discover";
  submit: "handrail_developer_change_v1_submit";
  list: "handrail_developer_change_v1_list";
  lookup: "handrail_developer_change_v1_lookup";
  releaseStatus: "handrail_developer_change_v1_release_status";
  dismiss: "handrail_developer_change_v1_dismiss";
  clarify: "handrail_developer_change_v1_clarify";
  cancel: "handrail_developer_change_v1_cancel";
}>;
export interface FeedbackToolDefinition {
  surface: "feedback" | "bug" | "enhancement";
  operation: "addAttachments" | "listAttachments" | "getAttachment" | "followUp" | "stopFollowUp" | "discover" | "submit" | "list" | "lookup" | "releaseStatus" | "archive" | "restore" | "cancel" | "clarify" | "answer" | "subscribe";
  name: typeof FEEDBACK_TOOL_NAMES[keyof typeof FEEDBACK_TOOL_NAMES];
  title: string;
  description: string;
  schema: Record<string, ZodType>;
  readOnly?: boolean;
  strict?: boolean;
}
export const FEEDBACK_TOOL_DEFINITIONS: readonly FeedbackToolDefinition[];

export interface FeedbackObservationBinding {
  project_id: string; service_env_id: string; environment: string;
  user_ref: string; tenant_ref: string; conversation_id: string;
}
export interface FeedbackObservationGrant {
  id: string; kind: "bug" | "enhancement"; report_id: string;
  binding: FeedbackObservationBinding; expires_at: string; cancelled: boolean;
}
/** Server-only delegated transport. Never exposes mutation or session APIs. */
export function createFeedbackObservationClient(options?: { config?: Record<string, unknown>; env?: Record<string,string|undefined> }): {
  read(grant: FeedbackObservationGrant): Promise<{ contract_version: "v1"; observation: FeedbackObservationGrant; record: unknown }>;
  cancel(grant: FeedbackObservationGrant): Promise<unknown>;
};

export interface AppFeedbackUser {
  /** Present only for the current verified browser session. Never supply an OAuth bearer here. */
  sessionToken?: string;
  principalId: string;
  tenantId: string;
}
export interface AppFeedbackTool<C> {
  name: string;
  description: string;
  readOnly: boolean;
  schema: import("zod/v4").ZodObject;
  inputSchema: Record<string, unknown>;
  call(context: C, input: unknown): Promise<Record<string, unknown>>;
}
export const MCP_BODY_LIMIT_BYTES: number;
export interface FeedbackUploads<C> {
  handle(request: Request, context: C): Promise<Response>;
  resolve(ids: string[], user: AppFeedbackUser): { filename: string; data_url: string }[];
}
export function createFeedbackUploads<C>(options: {
  getVerifiedUser(context: C): AppFeedbackUser | null | Promise<AppFeedbackUser | null>;
}): FeedbackUploads<C>;
export function createAppFeedbackTools<C>(options: {
  attachmentTools?: boolean;
  uploads?: FeedbackUploads<C>;
  config: { bug?: Record<string, unknown>; enhancement?: Record<string, unknown>; fetch?: typeof fetch; issuerKey?: string };
  getVerifiedUser(context: C): AppFeedbackUser | null | Promise<AppFeedbackUser | null>;
}): AppFeedbackTool<C>[];
