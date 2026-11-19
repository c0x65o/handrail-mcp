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
  bugSubmit: "handrail_bug_reporter_v1_submit";
  bugList: "handrail_bug_reporter_v1_list";
  bugAnswer: "handrail_bug_reporter_v1_answer";
  bugLookup: "handrail_bug_reporter_v1_lookup";
  bugArchive: "handrail_bug_reporter_v1_archive";
  bugRestore: "handrail_bug_reporter_v1_restore";
  bugFollowUp: "handrail_bug_reporter_v1_follow_up";
  bugStopFollowUp: "handrail_bug_reporter_v1_stop_follow_up";
  bugSubscribe: "handrail_bug_reporter_v1_subscribe";
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
  operation: "followUp" | "stopFollowUp" | "discover" | "submit" | "list" | "lookup" | "releaseStatus" | "archive" | "restore" | "cancel" | "clarify" | "answer" | "subscribe";
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
