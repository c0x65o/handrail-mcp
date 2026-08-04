import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import release from "../RELEASE.json" with { type: "json" };
import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);

if (packageJson.version !== release.connector_version) throw new Error("Package and release versions do not match.");
await mkdir("dist", { recursive: true });
const { stdout } = await execFileAsync("npm", ["pack", "--pack-destination", "dist", "--json"]);
const packed = JSON.parse(stdout)[0];
const bytes = await readFile(`dist/${packed.filename}`);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  ...release,
  artifact: packed.filename,
  integrity: `sha256-${sha256}`,
  npm_integrity: packed.integrity,
  size: packed.size,
  unpacked_size: packed.unpackedSize,
  files: packed.files.map((file) => file.path).sort(),
};
await writeFile("dist/release-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w" });
console.log(`${packed.filename} ${manifest.integrity}`);
