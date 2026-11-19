import {
  FEEDBACK_TOOL_DEFINITIONS, FEEDBACK_TOOL_NAMES,
  type EnhancementClarificationInput, type EnhancementClarificationResponse,
  type FeedbackSubscriptionInput, type EnhancementSubscriptionResponse,
} from "@handrail/mcp/feedback";

const clarification: EnhancementClarificationInput = {
  request_id: "enhancement-1", information_request_id: "question-7", answer: "Current household",
};
const subscription: FeedbackSubscriptionInput = {
  request_id: clarification.request_id, reporter_notification: { notify_on_resolution: true },
};
// @ts-expect-error Consent is never optional or false.
const noConsent: FeedbackSubscriptionInput = { request_id: "bug-1", reporter_notification: { notify_on_resolution: false } };
// @ts-expect-error An answer must identify the exact assessment version.
const noVersion: EnhancementClarificationInput = { request_id: "enhancement-1", assessment_id: "assessment-7", answer: "All" };
// @ts-expect-error Caller-selected recipient is outside the contract.
const recipient: FeedbackSubscriptionInput = { ...subscription, email: "someone@example.test" };
function response(answer: EnhancementClarificationResponse, consent: EnhancementSubscriptionResponse) {
  const implementation: false = answer.implementation_authority;
  const active: true = consent.notification_subscription.active;
  const name: "handrail_enhancement_reporter_v1_clarify" = FEEDBACK_TOOL_NAMES.enhancementClarify;
  return { implementation, active, name, catalog: FEEDBACK_TOOL_DEFINITIONS, noConsent, noVersion, recipient };
}
void response;
