const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function enabled(value) {
  return value === true || TRUE_VALUES.has(String(value || "").trim().toLowerCase());
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

function reporterConfig(overrides, env) {
  const bug = overrides.bug || {};
  const enhancement = overrides.enhancement || {};
  const bugRequested = enabled(bug.enabled ?? env.HANDRAIL_BUG_REPORT_ENABLED);
  const enhancementRequested = enabled(
    enhancement.enabled ?? env.HANDRAIL_ENHANCEMENT_REPORTER_ENABLED,
  );
  const explicitlyRequested = enabled(
    overrides.enabled ?? env.HANDRAIL_ASSISTANT_FEEDBACK_ENABLED,
  );
  return {
    requested: explicitlyRequested || bugRequested || enhancementRequested,
    sessionToken: text(overrides.sessionToken ?? overrides.applicationSessionToken),
    bug: {
      requested: bugRequested,
      apiBaseUrl: text(bug.apiBaseUrl ?? env.HANDRAIL_BUG_REPORT_API_URL),
      projectId: text(bug.projectId ?? env.HANDRAIL_BUG_REPORT_PROJECT),
      environment: text(bug.environment ?? env.HANDRAIL_BUG_REPORT_ENV)?.toLowerCase(),
      reportToken: text(bug.reportToken ?? env.HANDRAIL_BUG_REPORT_TOKEN),
      serviceEnvId: text(bug.serviceEnvId ?? env.HANDRAIL_BUG_REPORT_SERVICE_ENV_ID),
      transport: text(bug.transport ?? env.HANDRAIL_BUG_REPORT_TRANSPORT),
      fetch: bug.fetch ?? overrides.fetch,
    },
    enhancement: {
      requested: enhancementRequested,
      apiUrl: text(enhancement.apiUrl ?? env.HANDRAIL_ENHANCEMENT_REPORTER_API_URL),
      projectId: text(enhancement.projectId ?? env.HANDRAIL_ENHANCEMENT_REPORTER_PROJECT_ID),
      capabilityId: text(enhancement.capabilityId ?? env.HANDRAIL_ENHANCEMENT_REPORTER_CAPABILITY_ID),
      serviceEnvId: text(enhancement.serviceEnvId ?? env.HANDRAIL_ENHANCEMENT_REPORTER_SERVICE_ENV_ID),
      token: text(enhancement.token ?? env.HANDRAIL_ENHANCEMENT_REPORTER_TOKEN),
      contractVersion: text(enhancement.contractVersion ?? env.HANDRAIL_ENHANCEMENT_REPORTER_VERSION),
      fetch: enhancement.fetch ?? overrides.fetch,
    },
  };
}

export function resolveFeedbackConfig(overrides = {}, env = process.env) {
  const resolved = reporterConfig(overrides, env);
  return Object.freeze({
    ...resolved,
    bug: Object.freeze(resolved.bug),
    enhancement: Object.freeze(resolved.enhancement),
  });
}
