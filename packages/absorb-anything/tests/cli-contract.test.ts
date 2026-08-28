import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const cli = path.resolve(import.meta.dirname, "../dist/cli.js");
const legacyFixture = path.resolve(import.meta.dirname, "../../../tests/fixtures/v014-workspace");
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

beforeEach(async () => {
  registryFile = path.join(await temporary("absorb-registry"), "clones.json");
});

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("flat Source command surface", () => {
  it("lists every Source verb at top level and exposes no source group", async () => {
    const help = await run(["--help"]);
    expect(help.code).toBe(0);
    for (const verb of [
      "add",
      "sync",
      "switch",
      "link",
      "home",
      "unlink",
      "capture",
      "import",
      "status",
      "log",
      "diff",
    ]) {
      expect(help.stdout).toMatch(new RegExp(`\\n  ${verb}(?: \\[| <|  )`));
    }
    expect(help.stdout).not.toMatch(/\n {2}source(?:\s|$)/);
    const grouped = await run(["source", "add"]);
    expect(grouped.code).not.toBe(0);
  });

  it("executes copy Source, link, capture, import, log, diff, analysis, and knowledge paths", async () => {
    const home = await temporary("absorb-home");
    const consumer = await temporary("absorb-consumer");
    const input = await temporary("absorb-input");
    await writeFile(path.join(input, "one.txt"), "one\n", "utf8");
    expect((await run(["init", home, "--name", "home"])).code).toBe(0);
    expect((await run(["init", consumer, "--name", "consumer"])).code).toBe(0);

    expect((await run(["add", input, "sample", "--root", home])).code).toBe(0);
    expect((await run(["capture", "sample", "--root", home])).code).toBe(0);
    expect(
      (await run(["link", home, "sample", "--alias", "linked", "--root", consumer])).code,
    ).toBe(0);
    const resolvedHome = await run(["home", "linked", "--root", consumer, "--json"]);
    expect(JSON.parse(resolvedHome.stdout)).toMatchObject({ relation: "ref", homeWorkspace: home });

    const replacement = await temporary("absorb-replacement");
    await writeFile(path.join(replacement, "two.txt"), "two\n", "utf8");
    expect((await run(["import", "sample", replacement, "--root", home])).code).toBe(0);
    expect((await run(["log", "sample", "--root", home, "--json"])).code).toBe(0);
    expect((await run(["diff", "sample", "--root", home, "--json"])).code).toBe(0);

    const analysis = await run([
      "analysis",
      "new",
      "Review sample",
      "--for-source",
      "sample",
      "--root",
      home,
      "--json",
    ]);
    expect(analysis.code).toBe(0);
    const analysisPath = JSON.parse(analysis.stdout).path as string;
    expect(
      (await run(["analysis", "close", analysisPath, "--exit", "adopt", "--root", home])).code,
    ).toBe(0);
    expect(
      (
        await run([
          "knowledge",
          "add",
          "pattern",
          "Reusable sample",
          "--from-analysis",
          analysisPath,
          "--root",
          home,
        ])
      ).code,
    ).toBe(0);
    expect((await run(["status", "sample", "--root", home])).code).toBe(0);
    expect((await run(["check", "--root", home])).code).toBe(0);

    expect((await run(["unlink", "linked", "--root", consumer])).code).toBe(0);
    expect((await run(["home", "linked", "--root", consumer])).code).not.toBe(0);
  });

  it("syncs and switches a Git-backed Source", async () => {
    const workspace = await temporary("absorb-git-workspace");
    const source = await temporary("absorb-git-source");
    await git(source, "init");
    await git(source, "config", "user.email", "test@example.invalid");
    await git(source, "config", "user.name", "Absorb Test");
    await writeFile(path.join(source, "tracked.txt"), "one\n", "utf8");
    await git(source, "add", ".");
    await git(source, "commit", "-m", "initial");
    await git(source, "branch", "feature");

    await cp(legacyFixture, workspace, { recursive: true });
    expect((await run(["add", source, "living", "--root", workspace])).code).toBe(0);
    await writeFile(path.join(source, "tracked.txt"), "two\n", "utf8");
    await git(source, "add", ".");
    await git(source, "commit", "-m", "second");
    expect((await run(["sync", "living", "--root", workspace, "--class", "patch"])).code).toBe(0);
    expect(
      await readFile(path.join(workspace, "sources", "living", "checkout", "tracked.txt"), "utf8"),
    ).toBe("two\n");
    expect((await run(["switch", "living", "feature", "--root", workspace, "--sync"])).code).toBe(
      0,
    );
    await expect(stat(path.join(workspace, ".absorb"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("emits point-of-use hints only after successful mutating commands", async () => {
    const workspace = await temporary("absorb-hints-workspace");
    const input = await temporary("absorb-hints-input");
    await writeFile(path.join(input, "hint.txt"), "hint\n", "utf8");
    expect((await run(["init", workspace, "--name", "hints"])).code).toBe(0);

    const added = await run(["add", input, "hinted", "--root", workspace]);
    expect(added.code).toBe(0);
    expect(added.stdout).toContain("Hint:");
    expect(added.stdout).not.toContain("source add");

    const status = await run(["status", "hinted", "--root", workspace]);
    expect(status.code).toBe(0);
    expect(status.stdout).not.toContain("Hint:");

    const failed = await run(["add", input, "hinted", "--root", workspace]);
    expect(failed.code).not.toBe(0);
    expect(`${failed.stdout}${failed.stderr}`).not.toContain("Hint:");
  });
});

describe("legacy physical-envelope command contract", () => {
  it("keeps every ordinary registered workspace command on .assay", async () => {
    const root = await temporary("absorb-legacy-all");
    const consumer = await temporary("absorb-legacy-consumer-all");
    await cp(legacyFixture, root, { recursive: true });
    await cp(legacyFixture, consumer, { recursive: true });
    const input = await temporary("absorb-legacy-all-input");
    await writeFile(path.join(input, "one.txt"), "one\n", "utf8");

    async function ordinary(args: readonly string[], workspace = root) {
      const result = await run(args);
      expect(result.code, `${args.join(" ")}\n${result.stderr}`).toBe(0);
      await expect(stat(path.join(workspace, ".absorb"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await stat(path.join(workspace, ".assay"))).toBeTruthy();
      return result;
    }

    await ordinary(["check", "--root", root]);
    await ordinary(["update", "--root", root]);
    await ordinary(["status", "--root", root]);
    await ordinary(["prime", "--root", root]);
    expect((await run(["explain", "source"])).code).toBe(0);

    await ordinary(["add", input, "copied", "--root", root]);
    await ordinary(["capture", "copied", "--root", root]);
    const replacement = await temporary("absorb-legacy-all-replacement");
    await writeFile(path.join(replacement, "two.txt"), "two\n", "utf8");
    await ordinary(["import", "copied", replacement, "--root", root]);
    await ordinary(["status", "copied", "--root", root]);
    await ordinary(["log", "copied", "--root", root]);
    await ordinary(["diff", "copied", "--root", root]);

    await ordinary(["link", root, "copied", "--alias", "linked", "--root", consumer], consumer);
    await ordinary(["home", "linked", "--root", consumer], consumer);
    await ordinary(["unlink", "linked", "--root", consumer], consumer);

    const analysis = await ordinary([
      "analysis",
      "new",
      "Legacy full surface",
      "--for-source",
      "copied",
      "--root",
      root,
      "--json",
    ]);
    const analysisPath = JSON.parse(analysis.stdout).path as string;
    await ordinary(["analysis", "close", analysisPath, "--exit", "adopt", "--root", root]);
    await ordinary([
      "knowledge",
      "add",
      "guide",
      "Legacy full surface",
      "--from-analysis",
      analysisPath,
      "--root",
      root,
    ]);

    const gitSource = await temporary("absorb-legacy-all-git");
    await git(gitSource, "init");
    await git(gitSource, "config", "user.email", "test@example.invalid");
    await git(gitSource, "config", "user.name", "Absorb Test");
    await writeFile(path.join(gitSource, "tracked.txt"), "one\n", "utf8");
    await git(gitSource, "add", ".");
    await git(gitSource, "commit", "-m", "initial");
    await git(gitSource, "branch", "feature");
    await ordinary(["add", gitSource, "living", "--root", root]);
    await writeFile(path.join(gitSource, "tracked.txt"), "two\n", "utf8");
    await git(gitSource, "add", ".");
    await git(gitSource, "commit", "-m", "second");
    await ordinary(["sync", "living", "--root", root]);
    await ordinary(["switch", "living", "feature", "--sync", "--root", root]);

    await mkdir(path.join(root, ".assay", "tasks", "foreign"), { recursive: true });
    await writeFile(path.join(root, ".assay", "tasks", "foreign", "task.json"), "not-json", "utf8");
    await ordinary(["check", "--root", root]);
  });
});

it("supports standalone, prime, explain, and workspace status", async () => {
  const workspace = await temporary("absorb-standalone-cli");
  expect((await run(["init", workspace, "--standalone", "--name", "standalone"])).code).toBe(0);
  expect((await run(["prime", "--root", workspace])).stdout).toContain("Absorb prime");
  expect((await run(["explain", "source"])).stdout).toContain("Source —");
  const status = await run(["status", "--root", workspace, "--json"]);
  expect(JSON.parse(status.stdout)).toMatchObject({ envelope: ".absorb", project: "standalone" });
});
