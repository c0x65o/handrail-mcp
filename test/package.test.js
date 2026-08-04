import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import packageJson from "../package.json" with { type: "json" };
import * as connector from "../src/index.js";

const execFileAsync = promisify(execFile);

test("package entrypoint and CLI expose matching connector/API versions", async () => {
  assert.equal(connector.CONNECTOR_VERSION, packageJson.version);
  assert.equal(connector.API_CONTRACT_VERSION, "v1");
  const { stdout } = await execFileAsync(process.execPath, ["src/cli.js", "--version"]);
  assert.match(stdout, new RegExp(`${packageJson.version}.*Handrail API v1`));
});

test("client serialization cannot reveal the service credential", () => {
  const client = new connector.HandrailClient({
    enabled: true,
    apiUrl: "https://handrail.example/api/assistant-change-bridge/v1",
    contractVersion: "v1",
    projectId: "project",
    capabilityId: "capability",
    token: "must-never-serialize",
    issuer: "issuer",
    subject: "subject",
  }, {});
  assert.doesNotMatch(JSON.stringify(client), /must-never-serialize/);
  assert.doesNotMatch(JSON.stringify(client.getConfig()), /must-never-serialize/);
});
