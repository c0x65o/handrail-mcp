import { resolveFeedbackConfig } from "./feedback-config.js";
import {
  createBugFeedbackClient,
  createEnhancementFeedbackClient,
} from "./feedback-clients.js";

const CONTRACT_VERSION = "v2";

function missing(config, fields) {
  return fields.filter((field) => !config[field]);
}

function unavailable(requested, reason, missingConfig = []) {
  return Object.freeze({
    requested,
    ready: false,
    reason,
    missing_config: Object.freeze(missingConfig),
  });
}

function available(discovery) {
  return Object.freeze({ requested: true, ready: true, reason: null, missing_config: Object.freeze([]), discovery });
}

function safeDiscoveryError(error) {
  return {
    code: "reporter_discovery_failed",
    status: Number(error?.statusCode || error?.status) || null,
  };
}

async function bugRuntime(config) {
  if (!config.requested) return { readiness: unavailable(false, "not_configured"), client: null };
  const missingConfig = missing(config, ["apiBaseUrl", "projectId", "environment", "reportToken", "serviceEnvId"]);
  if (config.transport && config.transport !== "server") missingConfig.push("server_transport");
  if (missingConfig.length) return { readiness: unavailable(true, "incomplete_runtime_config", missingConfig), client: null };
  if (!config.sessionToken) return { readiness: unavailable(true, "verified_session_required", ["application_session"]), client: null };
  try {
    const client = createBugFeedbackClient(config);
    const discovery = await client.discoverPolicy();
    if (!discovery) return { readiness: unavailable(true, "canonical_discovery_unavailable"), client: null };
    if (
      discovery.identityVerified !== true
      || discovery.projectId !== config.projectId
      || discovery.environment !== config.environment
    ) {
      return { readiness: unavailable(true, "canonical_discovery_mismatch"), client: null };
    }
    return { readiness: available(discovery), client };
  } catch (error) {
    return { readiness: { ...unavailable(true, "canonical_discovery_failed"), error: safeDiscoveryError(error) }, client: null };
  }
}

async function enhancementRuntime(config) {
  if (!config.requested) return { readiness: unavailable(false, "not_configured"), client: null };
  const missingConfig = missing(config, ["apiUrl", "projectId", "capabilityId", "serviceEnvId", "token", "contractVersion"]);
  if (config.contractVersion && config.contractVersion !== "v1") missingConfig.push("compatible_contract_version");
  if (missingConfig.length) return { readiness: unavailable(true, "incomplete_runtime_config", missingConfig), client: null };
  if (!config.sessionToken) return { readiness: unavailable(true, "verified_session_required", ["application_session"]), client: null };
  try {
    const client = createEnhancementFeedbackClient(config);
    const discovery = await client.discover();
    const capability = discovery?.capability || {};
    if (
      discovery?.enhancement_reporting?.enabled !== true
      || discovery?.principal?.authenticated !== true
      || discovery?.principal?.authentication_method !== "known_users_direct_session"
      || capability.id !== config.capabilityId
      || capability.project_id !== config.projectId
      || capability.service_env_id !== config.serviceEnvId
    ) {
      return { readiness: unavailable(true, "canonical_discovery_mismatch"), client: null };
    }
    return { readiness: available(discovery), client };
  } catch (error) {
    return { readiness: { ...unavailable(true, "canonical_discovery_failed"), error: safeDiscoveryError(error) }, client: null };
  }
}

export async function loadFeedbackRuntime(options = {}, env = process.env) {
  const config = resolveFeedbackConfig(options.config || {}, env);
  return runtimeFromConfig(config);
}

async function runtimeFromConfig(config) {
  if (!config.requested) {
    return Object.freeze({ requested: false, config, readiness: null, adapters: Object.freeze({}) });
  }
  const [bug, enhancement] = await Promise.all([
    bugRuntime({ ...config.bug, sessionToken: config.sessionToken }),
    enhancementRuntime({ ...config.enhancement, sessionToken: config.sessionToken }),
  ]);
  return Object.freeze({
    requested: true,
    config,
    readiness: Object.freeze({
      contract_version: CONTRACT_VERSION,
      principal: bug.readiness.ready || enhancement.readiness.ready
        ? { authenticated: true, source: "verified_known_user_discovery" }
        : { authenticated: false, source: null, session_present: Boolean(config.sessionToken) },
      reporters: Object.freeze({ bug: bug.readiness, enhancement: enhancement.readiness }),
    }),
    adapters: Object.freeze({ ...(bug.client ? { bug: bug.client } : {}), ...(enhancement.client ? { enhancement: enhancement.client } : {}) }),
  });
}

export function feedbackOperationAvailable(readiness, definition) {
  if (!readiness?.ready) return false;
  const discovery = readiness.discovery;
  if (["addAttachments", "listAttachments", "getAttachment"].includes(definition.operation)) return discovery?.document_attachments === true;
  if (["followUp", "stopFollowUp"].includes(definition.operation)) {
    return (definition.surface === "bug" ? discovery?.reporterObservations : discovery?.reporter_observations)?.available === true;
  }
  if (definition.surface === "enhancement" && ["answer", "clarify"].includes(definition.operation)) {
    return discovery?.enhancement_reporting?.workflow?.clarification_response === true;
  }
  if (definition.operation === "subscribe") {
    return (definition.surface === "bug" ? discovery?.reporterNotifications : discovery?.reporter_notifications)?.available === true;
  }
  return true;
}

export async function callFeedbackAdapter(runtime, definition, args) {
  if (definition.surface === "feedback") return (await runtimeFromConfig(runtime.config)).readiness;
  // Long-lived in-process/stdio connectors must not reuse admission evidence.
  // The canonical route also verifies identity and ownership at mutation time.
  const current = await (definition.surface === "bug" ? bugRuntime : enhancementRuntime)({
    ...runtime.config[definition.surface], sessionToken: runtime.config.sessionToken,
  });
  const client = current.client;
  if (!client || !feedbackOperationAvailable(current.readiness, definition)) {
    throw Object.assign(new Error(`${definition.surface} reporter operation is unavailable; refresh discovery.`), { code: `${definition.surface}_reporter_unavailable` });
  }
  if (args.attachments && current.readiness.discovery?.document_attachments !== true) throw new Error("This reporter credential or host does not support document attachments.");
  if (["answer", "clarify"].includes(definition.operation)) return client.answer(args);
  if (definition.operation === "followUp") {
    const { attachments, ...consent } = args;
    const grant = await client.grantObservation(consent);
    if (!attachments) return grant;
    try {
      const updated = await client.addAttachments({ request_id: args.request_id, attachments });
      return { ...grant, attachments: updated.attachments };
    } catch (error) {
      return { ...grant, attachment_update: { status: "unconfirmed", code: error.code || "attachment_update_failed",
        message: "Follow-up was saved. List attachments to check which files were saved, then add any missing files." } };
    }
  }
  if (definition.operation === "stopFollowUp") return client.cancelObservation(args.id, args.binding);
  if (["addAttachments", "listAttachments", "getAttachment"].includes(definition.operation)) return client[definition.operation](args);
  if (definition.operation === "subscribe") return client.subscribe(args);
  if (definition.surface === "bug") {
    if (definition.operation === "submit") return client.submit({
      title: args.title,
      description: args.description,
      impact: args.impact || "moderate",
      reproducer: args.reproducer,
      route: args.route,
      appVersion: args.app_version,
      eventId: args.event_id,
      attachments: args.attachments,
    });
    if (definition.operation === "list") return client.listBugs({ limit: args.limit, cursor: args.cursor, search: args.search, statusGroup: args.status_group, sort: args.sort, visibility: args.visibility });
    if (definition.operation === "lookup") return client.getBug(args.request_id);
    if (definition.operation === "archive") return client.archiveBug(args.request_id);
    if (definition.operation === "restore") return client.restoreBug(args.request_id);
  }
  if (definition.operation === "submit") return client.submit({ ...args, submission_kind: "enhancement" });
  if (definition.operation === "list") return client.list({ limit: args.limit, offset: args.offset, search: args.search, status_group: args.status_group, sort: args.sort, visibility: args.visibility });
  if (definition.operation === "lookup") return client.lookup({ request_id: args.request_id });
  if (definition.operation === "releaseStatus") return client.releaseStatus({ request_id: args.request_id });
  if (definition.operation === "archive") return client.dismiss({ request_id: args.request_id });
  if (definition.operation === "restore") return client.restore({ request_id: args.request_id });
  if (definition.operation === "cancel") return client.cancel({ request_id: args.request_id, reason: args.reason });
  throw new Error("Unsupported feedback reporter operation.");
}
