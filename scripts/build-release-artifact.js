import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import release from "../RELEASE.json" with { type: "json" };
import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

const expectedTag = `v${packageJson.version}`;
const expectedArtifact = `handrail-mcp-${packageJson.version}.tgz`;
const expectedGitPin = `github:c0x65o/handrail-mcp#${expectedTag}`;
if (packageJson.version !== release.connector_version) throw new Error("Package and release versions do not match.");
if (release.api_contract_version !== "v1") throw new Error("Release API contract version must be v1.");
if (release.immutable_release_tag !== expectedTag) throw new Error("Release tag does not match the package version.");
if (release.artifact !== expectedArtifact) throw new Error("Release artifact name does not match the package version.");
if (release.approved_git_pin !== expectedGitPin) throw new Error("Release Git pin does not match the immutable tag.");
if (release.npm_publication_status !== "absent" || release.approved_package_pin != null) {
  throw new Error("An unpublished candidate must not claim an npm registry pin.");
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "handrail-mcp-release-"));
try {
  const packs = [];
  for (const name of ["first", "second"]) {
    const destination = path.join(tempRoot, name);
    await mkdir(destination, { recursive: true });
    const { stdout } = await execFileAsync("npm", ["pack", "--pack-destination", destination, "--json"]);
    const packed = JSON.parse(stdout)[0];
    const bytes = await readFile(path.join(destination, packed.filename));
    packs.push({ packed, bytes, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  if (packs.some(({ packed }) => packed.filename !== expectedArtifact)) throw new Error("npm pack returned an unexpected artifact name.");
  if (packs[0].sha256 !== packs[1].sha256) throw new Error("npm pack did not produce a deterministic artifact digest.");

  await mkdir("dist", { recursive: true });
  await copyFile(path.join(tempRoot, "first", expectedArtifact), path.join("dist", expectedArtifact));
  const manifest = {
    ...release,
    artifact: expectedArtifact,
    integrity: `sha256-${packs[0].sha256}`,
    npm_integrity: packs[0].packed.integrity,
    size: packs[0].packed.size,
    unpacked_size: packs[0].packed.unpackedSize,
    files: packs[0].packed.files.map((file) => file.path).sort(),
  };
  await writeFile("dist/release-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w" });
  console.log(`${expectedArtifact} ${manifest.integrity}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
