import assert from 'node:assert/strict';
import { createConnectorServer, FEEDBACK_TOOL_DEFINITIONS, CONNECTOR_VERSION } from '@handrail/mcp';
import { FEEDBACK_TOOL_NAMES as names } from '@handrail/mcp/feedback';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const calls=[];
const fetch=async (url, init) => {
  calls.push({url,init});
  const bug=url.includes('mobile-bug-reports');
  const body=new URL(url).pathname.endsWith('/policy') ? {schema_version:1,project_id:'project',environment:'staging',reporter:{identity_verified:true},reporter_notifications:{available:true}}
    : url.endsWith('/discovery') ? {contract_version:'v1',capability:{id:'capability',project_id:'project',service_env_id:'runtime'},principal:{authenticated:true,authentication_method:'known_users_direct_session'},enhancement_reporting:{enabled:true,workflow:{clarification_response:true}},reporter_notifications:{available:true}}
    : url.endsWith('/clarifications') ? {contract_version:'v1',answered:true,replayed:false,assessment_id:'continuation',assessment_status:'queued',warning:null,implementation_authority:false,deployment_authority:false}
    : {...(bug?{}:{contract_version:'v1'}),notification_subscription:{active:true,created:true,recipient_hint:'u***@example.test',subscribed_at:'2026-10-02T00:00:00.000Z'}};
  return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
};
const {server}=await createConnectorServer({config:{enabled:false},env:{},feedbackConfig:{enabled:true,sessionToken:'fixture-only',fetch,
  bug:{enabled:true,apiBaseUrl:'https://fixture.invalid/api',projectId:'project',environment:'staging',serviceEnvId:'runtime',reportToken:'fixture-only',transport:'server'},
  enhancement:{enabled:true,apiUrl:'https://fixture.invalid/api/enhancement-reporting/v1',projectId:'project',capabilityId:'capability',serviceEnvId:'runtime',token:'fixture-only',contractVersion:'v1'}}});
const [clientSide,serverSide]=InMemoryTransport.createLinkedPair();
const client=new Client({name:'installed-consumer',version:'1'});
await server.connect(serverSide); await client.connect(clientSide);
const catalog=(await client.listTools()).tools;
assert.equal(catalog.length,16); assert.equal(FEEDBACK_TOOL_DEFINITIONS.length,16);
for (const name of [names.bugSubscribe,names.enhancementSubscribe,names.enhancementClarify]) assert.ok(catalog.some(t=>t.name===name));
const answer=await client.callTool({name:names.enhancementClarify,arguments:{request_id:'enhancement',assessment_id:'current',assessment_version:7,answer:'current household'}});
assert.equal(answer.structuredContent.answered,true);
for (const name of [names.bugSubscribe,names.enhancementSubscribe]) {
  const subscription=await client.callTool({name,arguments:{request_id:'report',reporter_notification:{notify_on_resolution:true}}});
  assert.equal(subscription.structuredContent.notification_subscription.active,true);
}
await client.close(); await server.close();
console.log(JSON.stringify({phase:'candidate-overlay-in-installed-tree',normalPackageImports:true,version:CONNECTOR_VERSION,catalogSize:catalog.length,newOperationsExecuted:3,upstream:'mock fetch; no network',publicationVerified:false}));
