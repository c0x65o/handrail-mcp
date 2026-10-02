import { resolveFeedbackConfig } from './feedback-config.js';
import { createBugFeedbackClient, createEnhancementFeedbackClient } from './feedback-clients.js';

/** Runtime credentials remain server-only. This transport has no session,
 * submission, clarification, staff or email methods, and accepts no URL. */
export function createFeedbackObservationClient({ config = {}, env = process.env } = {}) {
  const resolved = resolveFeedbackConfig(config, env);
  function client(grant) {
    const kind = grant?.kind;
    if (!['bug','enhancement'].includes(kind)) throw Error('feedback_observation_kind_invalid');
    const c = resolved[kind], b = grant.binding;
    if (!c.requested || c.projectId !== b?.project_id || c.serviceEnvId !== b?.service_env_id
      || (kind === 'bug' && c.environment !== b.environment)) throw Error('feedback_observation_runtime_mismatch');
    return kind === 'bug' ? createBugFeedbackClient(c) : createEnhancementFeedbackClient(c);
  }
  return Object.freeze({
    read: async grant => client(grant).readObservation(grant.id, grant.binding),
    cancel: async grant => client(grant).cancelObservation(grant.id, grant.binding),
  });
}
