import { execFile } from "node:child_process";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const cli = path.resolve(import.meta.dirname, "../dist/cli.js");
const roots: string[] = [];
let registryFile = "";

async function temporary(name: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `${name}-`));
  roots.push(root);
  return root;
}

async function run(args: readonly string[], cwd?: string) {
  try {
    const result = await execute(process.execPath, [cli, ...args], {
      cwd,
      env: { ...process.env, ABSORB_CLONE_REGISTRY: registryFile },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

async function git(root: string, ...args: string[]): Promise<void> {
  await execute("git", args, { cwd: root });
}

function json(result: Awaited<ReturnType<typeof run>>): Record<string, unknown> {
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

beforeEach(async () => {
  registryFile = path.join(await temporary("absorb-cli-registry"), "clones.json");
});

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Source CLI behavior matrix", () => {
  it("rejects retired mode options and exposes only flat Source wording", async () => {
    const help = await run(["add", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).not.toContain("--mode");
    expect(help.stdout).not.toContain("--capture-mode");
    expect(help.stdout).not.toContain("source add");

    const root = await temporary("absorb-cli-retired");
    const input = await temporary("absorb-cli-retired-input");
    expect((await run(["init", root, "--name", "retired"])).code).toBe(0);
    const retired = await run(["add", input, "old", "--mode", "copy", "--root", root]);
    expect(retired.code).not.toBe(0);
    expect(`${retired.stdout}${retired.stderr}`).not.toContain("Hint:");
  });

  it("reports copied Source mutation results and keeps read commands hint-free", async () => {
    const root = await temporary("absorb-cli-copy");
    const input = await temporary("absorb-cli-copy-input");
    await writeFile(path.join(input, "one.txt"), "one\n", "utf8");
    expect((await run(["init", root, "--name", "copy"])).code).toBe(0);

    expect(json(await run(["add", input, "sample", "--root", root, "--json"]))).toMatchObject({
      alias: "sample",
      hints: [expect.any(String)],
    });
    expect(json(await run(["capture", "sample", "--root", root, "--json"]))).toMatchObject({
      alias: "sample",
      hints: [expect.any(String)],
    });
    const replacement = await temporary("absorb-cli-copy-replacement");
    await writeFile(path.join(replacement, "two.txt"), "two\n", "utf8");
    expect(
      json(await run(["import", "sample", replacement, "--root", root, "--json"])),
    ).toMatchObject({ alias: "sample", hints: [expect.any(String)] });

    const refused = await run(["sync", "sample", "--root", root]);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain("absorb import");
    expect(refused.stderr).toContain("absorb capture");
    expect(refused.stderr).not.toContain("Hint:");

    const diffHuman = await run(["diff", "sample", "--root", root]);
    expect(diffHuman.stdout).toContain("Source diff: sample");
    expect(diffHuman.stdout).toContain("Changed:");
    const logHuman = await run(["log", "sample", "--root", root]);
    expect(logHuman.stdout).toContain("Source log: sample");
    expect(logHuman.stdout).toContain("[capture]");

    for (const args of [
      ["status", "sample", "--root", root, "--json"],
      ["log", "sample", "--root", root, "--json"],
      ["diff", "sample", "--root", root, "--json"],
    ]) {
      expect(json(await run(args))).not.toHaveProperty("hints");
    }
  });

  it("resolves a linked home, writes through it, and unlinks only the reference", async () => {
    const home = await temporary("absorb-cli-ref-home");
    const consumer = await temporary("absorb-cli-ref-consumer");
    const input = await temporary("absorb-cli-ref-input");
    await writeFile(path.join(input, "one.txt"), "one\n", "utf8");
    expect((await run(["init", home, "--name", "home"])).code).toBe(0);
    expect((await run(["init", consumer, "--name", "consumer"])).code).toBe(0);
    expect((await run(["add", input, "owned", "--root", home])).code).toBe(0);
    const brief = path.join(home, ".absorb", "sources", "owned", "brief.md");
    await writeFile(brief, "# Why this Source exists\n", "utf8");

    const linkedHuman = await run(["link", home, "owned", "--alias", "linked", "--root", consumer]);
    expect(linkedHuman.code).toBe(0);
    expect(linkedHuman.stdout).toContain("Reference: linked ref ->");
    expect(linkedHuman.stdout).toContain(`Home workspace: ${home}`);
    expect(linkedHuman.stdout).toContain(`Brief: ${brief}`);

    expect(
      json(await run(["link", home, "owned", "--alias", "linked", "--root", consumer, "--json"])),
    ).toMatchObject({
      alias: "linked",
      home: { workspace: home, alias: "owned" },
      hints: [expect.any(String)],
    });
    expect(json(await run(["home", "linked", "--root", consumer, "--json"]))).toMatchObject({
      relation: "ref",
      homeWorkspace: home,
      homeAlias: "owned",
    });
    const homeHuman = await run(["home", "linked", "--root", consumer]);
    expect(homeHuman.stdout).toContain("Relation: ref");
    expect(homeHuman.stdout).toContain(`Home workspace: ${home}`);
    const capturedHuman = await run(["capture", "linked", "--root", consumer]);
    expect(capturedHuman.stdout).toContain("writing through to the Source home");
    expect(capturedHuman.stdout).toContain(`Home workspace: ${home}`);
    expect(json(await run(["capture", "linked", "--root", consumer, "--json"]))).toMatchObject({
      alias: "linked",
      root: home,
      reference: { homeRoot: home },
      hints: [expect.any(String)],
    });
    const registryLink = await run(["link", "owned", "--alias", "registry", "--root", consumer]);
    expect(registryLink.code).toBe(0);
    expect(registryLink.stdout).toContain("Registry: resolved 'owned'");
    expect((await run(["unlink", "registry", "--root", consumer])).code).toBe(0);
    expect(json(await run(["unlink", "linked", "--root", consumer, "--json"]))).toMatchObject({
      alias: "linked",
      hints: [expect.any(String)],
    });
    expect((await run(["home", "linked", "--root", consumer])).code).not.toBe(0);

    const ownedFailure = await run(["unlink", "owned", "--root", home]);
    expect(ownedFailure.code).not.toBe(0);
    expect(ownedFailure.stderr).toContain("unlink removes references only");
    expect(ownedFailure.stderr).not.toContain("Hint:");
    const ownedHome = await run(["home", "owned", "--root", home]);
    expect(ownedHome.stdout).toContain("Relation: owned");
  });

  it("keeps a broken reference visible while workspace status remains readable", async () => {
    const parent = await temporary("absorb-cli-broken-parent");
    const home = path.join(parent, "home");
    const moved = path.join(parent, "moved-home");
    const consumer = path.join(parent, "consumer");
    const input = await temporary("absorb-cli-broken-input");
    await writeFile(path.join(input, "one.txt"), "one\n", "utf8");
    expect((await run(["init", home, "--name", "home"])).code).toBe(0);
    expect((await run(["init", consumer, "--name", "consumer"])).code).toBe(0);
    expect((await run(["add", input, "owned", "--root", home])).code).toBe(0);
    expect((await run(["link", home, "owned", "--root", consumer])).code).toBe(0);
    await rename(home, moved);

    const status = await run(["status", "--root", consumer]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("Broken references: 1");
    const sourceStatus = await run(["status", "owned", "--root", consumer]);
    expect(sourceStatus.code).toBe(0);
    expect(sourceStatus.stdout).toContain("broken reference");
    const failed = await run(["capture", "owned", "--root", consumer]);
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain("broken reference");
    expect(failed.stderr).toContain("absorb link");
    expect((await run(["check", "--root", consumer])).code).toBe(1);
  });

  it("syncs and switches Git-backed Sources with ref and dirty-state errors", async () => {
    const root = await temporary("absorb-cli-git");
    const source = await temporary("absorb-cli-git-source");
    await git(source, "init");
    await git(source, "config", "user.email", "test@example.invalid");
    await git(source, "config", "user.name", "Absorb Test");
    await writeFile(path.join(source, "tracked.txt"), "one\n", "utf8");
    await git(source, "add", ".");
    await git(source, "commit", "-m", "initial");
    await git(source, "branch", "feature");
    await git(source, "branch", "base");
    await git(source, "checkout", "feature");
    await writeFile(path.join(source, "tracked.txt"), "feature\n", "utf8");
    await git(source, "add", ".");
    await git(source, "commit", "-m", "feature content");
    await git(source, "checkout", "base");
    expect((await run(["init", root, "--name", "git"])).code).toBe(0);
    expect((await run(["add", source, "living", "--root", root])).code).toBe(0);

    await writeFile(path.join(source, "tracked.txt"), "two\n", "utf8");
    await git(source, "add", ".");
    await git(source, "commit", "-m", "second");
    expect(json(await run(["sync", "living", "--root", root, "--json"]))).toMatchObject({
      alias: "living",
      hints: [expect.any(String)],
    });
    expect(
      json(await run(["switch", "living", "feature", "--sync", "--root", root, "--json"])),
    ).toMatchObject({ alias: "living", hints: [expect.any(String)] });

    const checkout = path.join(root, ".absorb", "sources", "living", "checkout");
    await writeFile(path.join(checkout, "tracked.txt"), "dirty\n", "utf8");
    const dirty = await run(["switch", "living", "base", "--root", root]);
    expect(dirty.code).not.toBe(0);
    expect(`${dirty.stdout}${dirty.stderr}`).not.toContain("Hint:");
  });
});

describe("orientation and lifecycle CLI matrix", () => {
  it("primes both an uninitialized directory and a workspace", async () => {
    const outside = await temporary("absorb-cli-prime-outside");
    expect(json(await run(["prime", "--root", outside, "--json"]))).toMatchObject({
      workspace: null,
      topics: ["workspace", "project", "source", "analysis", "knowledge"],
      detailsCommand: "absorb explain <topic>",
    });
    const root = await temporary("absorb-cli-prime-workspace");
    expect((await run(["init", root, "--name", "prime"])).code).toBe(0);
    expect(json(await run(["prime", "--root", root, "--json"]))).toMatchObject({
      workspace: { envelope: ".absorb", project: "prime" },
    });
  });

  it("explains every object case-insensitively and rejects foreign topics", async () => {
    for (const topic of ["workspace", "project", "source", "analysis", "knowledge"]) {
      expect(json(await run(["explain", topic.toUpperCase(), "--json"]))).toMatchObject({ topic });
    }
    const human = await run(["explain", "source"]);
    expect(human.stdout).toContain("Why it exists:");
    expect(human.stdout).toContain("When not to use it:");
    expect(human.stdout).toContain("Common misuses:");
    const unknown = await run(["explain", "task"]);
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain("workspace, project, source, analysis, knowledge");
  });

  it("emits lifecycle JSON hints and a copied-evidence close pin", async () => {
    const root = await temporary("absorb-cli-lifecycle");
    const input = await temporary("absorb-cli-lifecycle-input");
    await writeFile(path.join(input, "evidence.txt"), "evidence\n", "utf8");
    expect((await run(["init", root, "--name", "lifecycle"])).code).toBe(0);
    expect((await run(["add", input, "evidence", "--root", root])).code).toBe(0);
    const created = json(
      await run([
        "analysis",
        "new",
        "Interpret evidence",
        "--for-source",
        "evidence",
        "--root",
        root,
        "--json",
      ]),
    );
    expect(created).toMatchObject({ hints: [expect.any(String)] });
    const analysisPath = created.path as string;
    const closed = await run([
      "analysis",
      "close",
      analysisPath,
      "--exit",
      "adopt",
      "--root",
      root,
    ]);
    expect(closed.code).toBe(0);
    expect(closed.stdout).toContain("absorb capture evidence");
    expect(closed.stdout).toContain("Hint:");
    expect(
      json(
        await run([
          "knowledge",
          "add",
          "guide",
          "Reusable evidence",
          "--from-analysis",
          analysisPath,
          "--root",
          root,
          "--json",
        ]),
      ),
    ).toMatchObject({ hints: [expect.any(String)] });

    const experiment = json(
      await run(["analysis", "new", "Try something", "--root", root, "--json"]),
    );
    const experimentClosed = await run([
      "analysis",
      "close",
      experiment.path as string,
      "--exit",
      "experiment",
      "--root",
      root,
    ]);
    expect(experimentClosed.code).toBe(0);
    expect(experimentClosed.stdout).not.toContain("Pin:");
  });
});
