import type { ZodType } from "zod/v4";

/** Canonical reporter arguments. Identity and runtime credentials are host-owned. */
export interface FeedbackRequestInput { request_id: string }
export interface EnhancementClarificationInput extends FeedbackRequestInput {
  /** Copy from the current lookup clarification; never manufacture or advance it. */
  assessment_id: string;
  /** Positive safe integer from the same clarification. */
  assessment_version: number;
  /** Nonblank, at most 4,000 characters; preserve for an exact retry. */
  answer: string;
}
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
  bugLookup: "handrail_bug_reporter_v1_lookup";
  bugArchive: "handrail_bug_reporter_v1_archive";
  bugRestore: "handrail_bug_reporter_v1_restore";
  bugSubscribe: "handrail_bug_reporter_v1_subscribe";
  enhancementSubmit: "handrail_enhancement_reporter_v1_submit";
  enhancementList: "handrail_enhancement_reporter_v1_list";
  enhancementLookup: "handrail_enhancement_reporter_v1_lookup";
  enhancementReleaseStatus: "handrail_enhancement_reporter_v1_release_status";
  enhancementArchive: "handrail_enhancement_reporter_v1_archive";
  enhancementRestore: "handrail_enhancement_reporter_v1_restore";
  enhancementCancel: "handrail_enhancement_reporter_v1_cancel";
  enhancementClarify: "handrail_enhancement_reporter_v1_clarify";
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
  operation: "discover" | "submit" | "list" | "lookup" | "releaseStatus" | "archive" | "restore" | "cancel" | "clarify" | "subscribe";
  name: typeof FEEDBACK_TOOL_NAMES[keyof typeof FEEDBACK_TOOL_NAMES];
  title: string;
  description: string;
  schema: Record<string, ZodType>;
  readOnly?: boolean;
  strict?: boolean;
}
export const FEEDBACK_TOOL_DEFINITIONS: readonly FeedbackToolDefinition[];
