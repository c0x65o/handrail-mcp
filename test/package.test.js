import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

import packageJson from "../package.json" with { type: "json" };
import release from "../RELEASE.json" with { type: "json" };
import * as connector from "../src/index.js";

const execFileAsync = promisify(execFile);

test("package entrypoint and CLI expose matching connector/API versions", async () => {
  const packageLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.equal(connector.CONNECTOR_VERSION, packageJson.version);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.equal(connector.API_CONTRACT_VERSION, "v1");
  assert.equal(release.connector_version, packageJson.version);
  assert.equal(release.api_contract_version, connector.API_CONTRACT_VERSION);
  assert.equal(release.immutable_release_tag, `v${packageJson.version}`);
  assert.equal(release.artifact, `handrail-mcp-${packageJson.version}.tgz`);
  assert.equal(release.approved_git_pin, `github:c0x65o/handrail-mcp#v${packageJson.version}`);
  assert.equal(release.npm_publication_status, "absent");
  assert.equal(release.approved_package_pin, null);
  assert.ok(readme.includes(`Current connector version: \`${packageJson.version}\``));
  assert.ok(readme.includes(`github:c0x65o/handrail-mcp#v${packageJson.version}`));
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
