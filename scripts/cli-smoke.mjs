import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "packages", "absorb-anything", "dist", "cli.js");
const cliPackage = JSON.parse(
  await readFile(path.join(root, "packages", "absorb-anything", "package.json"), "utf8"),
);
const corePackage = JSON.parse(
  await readFile(path.join(root, "packages", "absorb-anything-core", "package.json"), "utf8"),
);
assert.equal(cliPackage.version, "0.1.2");
assert.equal(corePackage.version, "0.1.2");

const temporary = await mkdtemp(path.join(os.tmpdir(), "absorb-smoke-"));
const input = await mkdtemp(path.join(os.tmpdir(), "absorb-smoke-input-"));
const registry = path.join(temporary, "clone-registry.json");
const run = async (...args) =>
  execute(process.execPath, [cli, ...args], {
    env: { ...process.env, ABSORB_CLONE_REGISTRY: registry },
  });

try {
  assert.equal((await run("--version")).stdout.trim(), cliPackage.version);
  await writeFile(path.join(temporary, "existing.txt"), "preserve\n", "utf8");
  await writeFile(path.join(input, "material.txt"), "evidence\n", "utf8");
  await run("init", temporary, "--name", "smoke");
  assert.equal(await readFile(path.join(temporary, "existing.txt"), "utf8"), "preserve\n");
  await run("add", input, "sample", "--root", temporary);
  await run("capture", "sample", "--root", temporary);
  await run("analysis", "new", "Smoke review", "--for-source", "sample", "--root", temporary);
  await run("knowledge", "add", "pattern", "Smoke pattern", "--root", temporary);
  await run("check", "--root", temporary);
  await run("prime", "--root", temporary);
  await run("explain", "source");
  console.log(`CLI smoke passed (${cliPackage.version})`);
} finally {
  await rm(temporary, { recursive: true, force: true });
  await rm(input, { recursive: true, force: true });
}
