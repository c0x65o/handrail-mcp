import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function sourceText(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".js"));
  return (await Promise.all(names.map((name) => readFile(new URL(name, directory), "utf8")))).join("\n");
}

test("shipped connector has no database, control-plane, deployment, or client-secret implementation", async () => {
  const source = await sourceText(new URL("../src/", import.meta.url));
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const dependencies = Object.keys(packageJson.dependencies || {});
  assert.deepEqual(dependencies, ["@modelcontextprotocol/sdk", "zod"]);
  assert.doesNotMatch(source, /DATABASE_URL|MYSQL_|POSTGRES_|mongodb:|redis:|from ["'](?:pg|mysql|sqlite|prisma|sequelize|knex)/i);
  assert.doesNotMatch(source, /createWorkRequest|createOwnerGoal|deploy(?:ment)?Executor|kubectl|docker\s+(?:build|push)|stateMachine/i);
  assert.doesNotMatch(source, /BROWSER.*(?:TOKEN|SECRET)|MOBILE.*(?:TOKEN|SECRET)|NEXT_PUBLIC_.*(?:TOKEN|SECRET)|VITE_.*(?:TOKEN|SECRET)/i);
  assert.doesNotMatch(source, /Authoritative central contract body|Assistant Change Bridge v1 Contract\n/i, "KB bodies must not ship in source");
});
