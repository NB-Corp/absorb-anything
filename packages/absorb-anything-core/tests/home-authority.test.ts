import { exec } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { assertNoAncestorWorkspaceAuthority, initFramework, loadManifest } from "../src/index.js";

const execAsync = promisify(exec);
const cleanups: (() => Promise<void>)[] = [];

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * The real home is the only one the guard can be tested against: relocating it
 * would leave the developer's actual `~/.absorb` sitting in the ancestry as an
 * ordinary directory, which is a different case.
 */
async function homeHoldingCloneRegistry(): Promise<string> {
  const home = os.homedir();
  const envelope = path.join(home, ".absorb");
  if (!(await exists(envelope))) {
    await mkdir(envelope, { recursive: true });
    cleanups.push(() => rm(envelope, { recursive: true, force: true }));
  }
  const registry = path.join(envelope, "clone-registry.json");
  if (!(await exists(registry))) {
    await writeFile(registry, JSON.stringify({ __schema: 1, sources: {} }), "utf8");
    cleanups.push(() => rm(registry, { force: true }));
  }
  return home;
}

/** A working directory under the home, the way an ordinary project sits there. */
async function projectUnderHome(home: string): Promise<string> {
  const root = await mkdtemp(path.join(home, "absorb-home-authority-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

/** The 8.3 form Windows hands out for a long directory name, when enabled. */
async function shortPath(target: string): Promise<string> {
  const { stdout } = await execAsync(`for %I in ("${target}") do @echo %~sI`, { shell: "cmd.exe" });
  return stdout.trim();
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("the home directory is config, not workspace authority", () => {
  it("initializes under a home whose .absorb holds only the clone registry", async () => {
    const home = await homeHoldingCloneRegistry();
    const target = path.join(await projectUnderHome(home), "product");
    await mkdir(target, { recursive: true });

    await initFramework({ target, name: "Product" });

    expect(await loadManifest(target)).not.toBeNull();
  });

  it.runIf(process.platform === "win32")(
    "recognizes the home when the ancestor path arrives as an 8.3 short name",
    async () => {
      // Windows hands out short names for long user names (C:\Users\RUNNER~1),
      // and those never string-match the long home the guard compares against.
      const home = await homeHoldingCloneRegistry();
      const short = await shortPath(home);
      if (short.toLowerCase() === home.toLowerCase()) return; // no 8.3 name for this home

      const project = await projectUnderHome(home);
      const target = path.join(short, path.basename(project), "product");
      await mkdir(target, { recursive: true });

      await initFramework({ target, name: "Product" });

      expect(await loadManifest(target)).not.toBeNull();
    },
  );

  // Initializing *through* a link is refused elsewhere by the write boundary;
  // what matters here is that the ancestor guard resolves the link to the home
  // rather than reading it as a foreign envelope.
  it("recognizes the home through a link that spells it differently", async () => {
    const home = await homeHoldingCloneRegistry();
    const project = await projectUnderHome(home);
    const link = path.join(await mkdtemp(path.join(os.tmpdir(), "absorb-home-link-")), "home");
    cleanups.push(() => rm(path.dirname(link), { recursive: true, force: true }));
    await symlink(home, link, process.platform === "win32" ? "junction" : "dir");

    const target = path.join(link, path.basename(project), "product");

    await expect(assertNoAncestorWorkspaceAuthority(target)).resolves.toBeUndefined();
  });

  it("still refuses a target nested under a real workspace", async () => {
    const home = await homeHoldingCloneRegistry();
    const outer = await projectUnderHome(home);
    await initFramework({ target: outer, name: "Outer" });
    const nested = path.join(outer, "inner");
    await mkdir(nested, { recursive: true });

    await expect(initFramework({ target: nested, name: "Inner" })).rejects.toThrow(
      /nested under an existing workspace/,
    );
  });
});
