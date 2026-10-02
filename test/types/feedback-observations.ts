import {createFeedbackObservationClient, FEEDBACK_TOOL_NAMES, type FeedbackObservationGrant} from '../../src/feedback-schemas.js';
const grant: FeedbackObservationGrant={id:'grant',kind:'enhancement',report_id:'report',binding:{project_id:'project',service_env_id:'runtime',environment:'staging',tenant_ref:'tenant',user_ref:'user',conversation_id:'conversation'},expires_at:'2099-01-01T00:00:00Z',cancelled:false};
const client=createFeedbackObservationClient({env:{}});
void client.read(grant);
void client.cancel(grant);
const name:'handrail_enhancement_reporter_v1_follow_up'=FEEDBACK_TOOL_NAMES.enhancementFollowUp;
void name;
