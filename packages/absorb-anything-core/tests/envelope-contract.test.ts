import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  ABSORB_AGENTS_END_MARKER,
  ABSORB_AGENTS_START_MARKER,
  addKnowledge,
  addSource,
  applyUpdate,
  captureSource,
  checkFramework,
  closeAnalysis,
  createAnalysis,
  diffSource,
  discoverFrameworkRoot,
  getFrameworkStatus,
  getSourceLog,
  getSourceStatus,
  importSourceContent,
  initFramework,
  linkSource,
  loadManagedFiles,
  loadManifest,
  migrateEnvelope,
  resolveSourceHome,
  setUpdatePlanProbeForTests,
  unlinkSource,
} from "../src/index.js";

const roots: string[] = [];
const fixture = path.resolve(import.meta.dirname, "../../../tests/fixtures/v014-workspace");

async function temporary(name: string): Promise<string> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), `${name}-`)),
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

interface FileFact {
  readonly hash: string;
  readonly mtimeMs: number;
}
async function fileFacts(root: string): Promise<Record<string, FileFact>> {
  const facts: Record<string, FileFact> = {};
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).replaceAll("\\", "/");
        facts[relative] = {
          hash: createHash("sha256")
            .update(await readFile(absolute))
            .digest("hex"),
          mtimeMs: (await stat(absolute)).mtimeMs,
        };
      }
    }
  }
  await walk(root);
  return facts;
}

describe("physical envelope projection", () => {
  it("initializes overlay without changing repository-root files", async () => {
    const root = await temporary("absorb-overlay");
    const protectedFile = path.join(root, "README.md");
    await writeFile(protectedFile, "existing product readme\n", "utf8");

    const result = await initFramework({ target: root, name: "overlay-demo" });

    expect(result.mode).toBe("overlay");
    expect(await readFile(protectedFile, "utf8")).toBe("existing product readme\n");
    expect(await stat(path.join(root, ".absorb", "sources"))).toBeTruthy();
    await expect(stat(path.join(root, "sources"))).rejects.toMatchObject({ code: "ENOENT" });
    const raw = JSON.parse(await readFile(path.join(root, ".absorb", "manifest.json"), "utf8"));
    expect(raw).toMatchObject({
      __schema: 4,
      framework_version: "0.14.0",
      layout: { version: 8, state_root: ".assay", work_root: ".assay" },
    });
    expect(JSON.stringify(raw)).not.toContain('".absorb/');
    expect((await checkFramework({ root })).ok).toBe(true);
    expect((await getFrameworkStatus({ root })).zones).toContainEqual({
      path: ".absorb/sources",
      purpose: "External material and observation history",
      files: 1,
    });
  });

  it("initializes standalone only when explicitly selected", async () => {
    const root = await temporary("absorb-standalone");
    await initFramework({ target: root, name: "standalone-demo", standalone: true });
    expect(await stat(path.join(root, ".absorb", "manifest.json"))).toBeTruthy();
    expect(await stat(path.join(root, "sources"))).toBeTruthy();
    expect(await stat(path.join(root, "project", "project.yaml"))).toBeTruthy();
    expect((await checkFramework({ root })).ok).toBe(true);
  });

  it("selects .absorb without falling back to a valid same-root legacy envelope", async () => {
    const root = await temporary("absorb-precedence");
    await cp(fixture, root, { recursive: true });
    await mkdir(path.join(root, ".absorb"));
    await expect(loadManifest(root)).rejects.toThrow("Selected envelope is missing manifest.json");
  });

  it("fails closed at the nearest envelope entry instead of falling back to an ancestor", async () => {
    const parent = await temporary("absorb-nearest-parent");
    await cp(fixture, parent, { recursive: true });
    const child = path.join(parent, "child");
    const nested = path.join(child, "nested");
    await mkdir(path.join(child, ".absorb"), { recursive: true });
    await mkdir(nested, { recursive: true });

    await expect(discoverFrameworkRoot(nested)).rejects.toThrow(
      "Selected envelope is missing manifest.json",
    );
    expect(await loadManifest(parent)).not.toBeNull();
  });
});

describe("legacy compatibility and migration", () => {
  it("runs owned commands in place on the v0.14 fixture and ignores foreign records", async () => {
    const root = await temporary("absorb-legacy");
    await cp(fixture, root, { recursive: true });
    await mkdir(path.join(root, ".assay", "tasks", "foreign"), { recursive: true });
    await writeFile(path.join(root, ".assay", "tasks", "foreign", "task.json"), "not-json", "utf8");
    await mkdir(path.join(root, ".assay", "source-adoptions"), { recursive: true });
    await writeFile(
      path.join(root, ".assay", "source-adoptions", "foreign.yaml"),
      ": invalid",
      "utf8",
    );
    await writeFile(path.join(root, ".assay", "systems-registry.json"), "not-json", "utf8");
    const input = await temporary("absorb-input");
    await writeFile(path.join(input, "sample.txt"), "sample\n", "utf8");

    await addSource({ root, source: input, alias: "legacy" });
    await captureSource({ root, alias: "legacy" });
    const replacement = await temporary("absorb-replacement");
    await writeFile(path.join(replacement, "replacement.txt"), "replacement\n", "utf8");
    await importSourceContent({ root, alias: "legacy", from: replacement });
    await createAnalysis({ root, title: "Legacy analysis", forSource: "legacy" });
    await addKnowledge({ root, type: "guide", title: "Legacy guide" });

    const consumer = await temporary("absorb-legacy-consumer");
    await cp(fixture, consumer, { recursive: true });
    await linkSource({ root: consumer, workspace: root, source: "legacy", alias: "linked" });
    expect((await resolveSourceHome({ root: consumer, alias: "linked" })).homeWorkspace).toBe(root);
    await unlinkSource({ root: consumer, alias: "linked" });

    expect(await stat(path.join(root, "sources", "legacy", "source.yaml"))).toBeTruthy();
    await expect(stat(path.join(root, ".absorb"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await getSourceStatus({ root, alias: "legacy" })).sources).toHaveLength(1);
    expect((await getSourceLog({ root, alias: "legacy" })).entries.length).toBeGreaterThanOrEqual(
      3,
    );
    expect((await diffSource({ root, alias: "legacy" })).alias).toBe("legacy");
    expect((await checkFramework({ root })).ok).toBe(true);
  });

  it("renames only, is idempotent, and leaves file bytes, mtimes, and event lines unchanged", async () => {
    const root = await temporary("absorb-migrate");
    await cp(fixture, root, { recursive: true });
    const before = await fileFacts(path.join(root, ".assay"));
    const eventFile = path.join(root, ".assay", "events", "2026-08.jsonl");
    const eventLinesBefore = await readFile(eventFile, "utf8").catch(() => "");

    expect((await migrateEnvelope(root)).changed).toBe(true);
    await expect(stat(path.join(root, ".assay"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fileFacts(path.join(root, ".absorb"))).toEqual(before);
    expect(
      await readFile(path.join(root, ".absorb", "events", "2026-08.jsonl"), "utf8").catch(() => ""),
    ).toBe(eventLinesBefore);
    expect((await migrateEnvelope(root)).changed).toBe(false);
    expect(await fileFacts(path.join(root, ".absorb"))).toEqual(before);
    expect((await checkFramework({ root })).ok).toBe(true);

    const input = await temporary("absorb-after-migration");
    await writeFile(path.join(input, "after.txt"), "after\n", "utf8");
    await addSource({ root, source: input, alias: "after-migration" });
    await captureSource({ root, alias: "after-migration" });
    await createAnalysis({ root, title: "After migration", forSource: "after-migration" });
    await addKnowledge({ root, type: "pattern", title: "After migration" });
    expect((await checkFramework({ root })).ok).toBe(true);
  });

  it("refuses a both-directory conflict without changing either tree", async () => {
    const root = await temporary("absorb-conflict");
    await cp(fixture, root, { recursive: true });
    await cp(path.join(root, ".assay"), path.join(root, ".absorb"), { recursive: true });
    const beforeLegacy = await fileFacts(path.join(root, ".assay"));
    const beforePreferred = await fileFacts(path.join(root, ".absorb"));
    await expect(migrateEnvelope(root)).rejects.toThrow("Both .absorb and .assay exist");
    expect(await fileFacts(path.join(root, ".assay"))).toEqual(beforeLegacy);
    expect(await fileFacts(path.join(root, ".absorb"))).toEqual(beforePreferred);
  });

  it("reports a missing envelope without creating state", async () => {
    const root = await temporary("absorb-migration-missing");
    await expect(migrateEnvelope(root)).rejects.toThrow("No envelope found");
    await expect(stat(path.join(root, ".absorb"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(root, ".assay"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

it("preserves valid managed receipt records owned by another product", async () => {
  const root = await temporary("absorb-update");
  await initFramework({ target: root, name: "receipt-demo" });
  const receiptFile = path.join(root, ".absorb", "managed-files.json");
  const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
  receipt.files.push({
    path: ".assay/foreign-owned.txt",
    generator: "foreign.generator",
    baseline_hash: "a".repeat(64),
    protected: true,
    executable: false,
  });
  await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

  const result = await applyUpdate({ root });

  expect(result.preservedUnknownRecords).toBe(1);
  expect(
    (await loadManagedFiles(root)).files.some((record) => record.generator === "foreign.generator"),
  ).toBe(true);
});

describe("update and state rewrite boundaries", () => {
  it("CAS-refuses an external edit to an existing target after planning", async () => {
    const root = await temporary("absorb-update-existing-race");
    await initFramework({ target: root, name: "race", standalone: true });
    const target = path.join(root, "README.md");
    await writeFile(target, "planned user edit\n", "utf8");
    setUpdatePlanProbeForTests(async (_root, entries) => {
      if (entries.some((entry) => entry.path === "README.md" && entry.action === "force")) {
        await writeFile(target, "newer external bytes\n", "utf8");
      }
    });
    try {
      await expect(applyUpdate({ root, action: "force" })).rejects.toMatchObject({
        code: "AUTHORITY_WRITE_CONFLICT",
      });
    } finally {
      setUpdatePlanProbeForTests(undefined);
    }
    expect(await readFile(target, "utf8")).toBe("newer external bytes\n");
  });

  it("preflights absent targets as a set and preserves a concurrent creator", async () => {
    const root = await temporary("absorb-update-absent-race");
    await initFramework({ target: root, name: "race" });
    const first = path.join(root, ".absorb", "README.md");
    const second = path.join(root, ".absorb", "backups", ".gitkeep");
    await rm(first);
    await rm(second);
    const receiptFile = path.join(root, ".absorb", "managed-files.json");
    const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
    receipt.files = receipt.files.filter(
      (entry: { path: string }) =>
        entry.path !== ".assay/README.md" && entry.path !== ".assay/backups/.gitkeep",
    );
    await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    setUpdatePlanProbeForTests(async (_root, entries) => {
      if (entries.some((entry) => entry.path === ".assay/backups/.gitkeep")) {
        await writeFile(second, "external winner\n", "utf8");
      }
    });
    try {
      await expect(applyUpdate({ root })).rejects.toMatchObject({
        code: "AUTHORITY_WRITE_CONFLICT",
      });
    } finally {
      setUpdatePlanProbeForTests(undefined);
    }
    await expect(stat(first)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(second, "utf8")).toBe("external winner\n");
  });

  it("writes create, baseline update, and force through successful CAS paths", async () => {
    const createRoot = await temporary("absorb-update-create-cas");
    await initFramework({ target: createRoot, name: "create" });
    const createTarget = path.join(createRoot, ".absorb", "README.md");
    await rm(createTarget);
    const createReceiptFile = path.join(createRoot, ".absorb", "managed-files.json");
    const createReceipt = JSON.parse(await readFile(createReceiptFile, "utf8"));
    createReceipt.files = createReceipt.files.filter(
      (entry: { path: string }) => entry.path !== ".assay/README.md",
    );
    await writeFile(createReceiptFile, `${JSON.stringify(createReceipt, null, 2)}\n`, "utf8");
    expect((await applyUpdate({ root: createRoot })).changes).toContainEqual({
      path: ".assay/README.md",
      kind: "new",
      action: "create",
    });
    expect(await readFile(createTarget, "utf8")).toContain("# .absorb/");

    const updateRoot = await temporary("absorb-update-baseline-cas");
    await initFramework({ target: updateRoot, name: "baseline", standalone: true });
    const updateTarget = path.join(updateRoot, "README.md");
    const oldBaseline = "old generated baseline\n";
    await writeFile(updateTarget, oldBaseline, "utf8");
    const updateReceiptFile = path.join(updateRoot, ".absorb", "managed-files.json");
    const updateReceipt = JSON.parse(await readFile(updateReceiptFile, "utf8"));
    const record = updateReceipt.files.find(
      (entry: { path: string }) => entry.path === "README.md",
    );
    record.baseline_hash = createHash("sha256").update(oldBaseline).digest("hex");
    await writeFile(updateReceiptFile, `${JSON.stringify(updateReceipt, null, 2)}\n`, "utf8");
    expect((await applyUpdate({ root: updateRoot })).changes).toContainEqual({
      path: "README.md",
      kind: "auto-update",
      action: "update",
    });
    expect(await readFile(updateTarget, "utf8")).toContain("# baseline");

    await writeFile(updateTarget, "user force candidate\n", "utf8");
    expect((await applyUpdate({ root: updateRoot, action: "force" })).changes).toContainEqual({
      path: "README.md",
      kind: "modified-by-user",
      action: "force",
    });
    expect(await readFile(updateTarget, "utf8")).toContain("# baseline");
  });

  it("refuses an existing create-new sidecar without changing its bytes", async () => {
    const root = await temporary("absorb-sidecar-conflict");
    await initFramework({ target: root, name: "sidecar", standalone: true });
    await writeFile(path.join(root, "README.md"), "user edit\n", "utf8");
    const sidecar = path.join(root, "README.md.new");
    await writeFile(sidecar, "precious sidecar\n", "utf8");

    await expect(applyUpdate({ root, action: "create-new" })).rejects.toMatchObject({
      code: "AUTHORITY_WRITE_CONFLICT",
    });
    expect(await readFile(sidecar, "utf8")).toBe("precious sidecar\n");
    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("user edit\n");
  });

  it("creates a new sidecar exclusively when the name is free", async () => {
    const root = await temporary("absorb-sidecar-create");
    await initFramework({ target: root, name: "sidecar", standalone: true });
    await writeFile(path.join(root, "README.md"), "user edit\n", "utf8");
    const result = await applyUpdate({ root, action: "create-new" });
    expect(result.changes).toContainEqual({
      path: "README.md",
      kind: "modified-by-user",
      action: "create-new",
    });
    expect(await readFile(path.join(root, "README.md.new"), "utf8")).toContain("# sidecar");
  });

  it("ticks only the selected checkbox inside the unique Decision exit section", async () => {
    const root = await temporary("absorb-analysis-section");
    await initFramework({ target: root, name: "analysis" });
    const created = await createAnalysis({ root, title: "Section boundary" });
    const original = await readFile(created.absolutePath, "utf8");
    await writeFile(
      created.absolutePath,
      original.replace("## Key observations\n", "## Key observations\n\n- [ ] adopt\n"),
      "utf8",
    );
    await closeAnalysis({ root, path: created.path, exit: "adopt" });
    const closed = await readFile(created.absolutePath, "utf8");
    expect(closed.slice(0, closed.indexOf("## Decision exit"))).toContain("- [ ] adopt");
    expect(closed.slice(closed.indexOf("## Decision exit"))).toContain("- [x] adopt");
  });

  it("refuses a missing or ambiguous Decision exit section before write or event", async () => {
    const root = await temporary("absorb-analysis-malformed");
    await initFramework({ target: root, name: "analysis" });
    const created = await createAnalysis({ root, title: "Malformed section" });
    const malformed = (await readFile(created.absolutePath, "utf8")).replace(
      "## Decision exit",
      "## Not a decision",
    );
    await writeFile(created.absolutePath, malformed, "utf8");
    const eventDir = path.join(root, ".absorb", "events");
    const beforeEvents = await fileFacts(eventDir);
    await expect(closeAnalysis({ root, path: created.path, exit: "adopt" })).rejects.toThrow(
      "exactly one '## Decision exit'",
    );
    expect(await readFile(created.absolutePath, "utf8")).toBe(malformed);
    expect(await fileFacts(eventDir)).toEqual(beforeEvents);
  });
});

describe("ported workspace lifecycle", () => {
  it("installs pnpm before setup-node initializes the pnpm cache", async () => {
    const workflow = await readFile(
      path.resolve(import.meta.dirname, "../../../.github/workflows/ci.yml"),
      "utf8",
    );
    const pnpmSetup = workflow.indexOf("uses: pnpm/action-setup@v4");
    const nodeSetup = workflow.indexOf("uses: actions/setup-node@v4");
    expect(pnpmSetup).toBeGreaterThan(0);
    expect(nodeSetup).toBeGreaterThan(pnpmSetup);
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("os: [ubuntu-latest, windows-latest]");
  });

  it.each([
    ["study", ".absorb/analyses/references"],
    ["solve", ".absorb/attempts"],
    ["explore", ".absorb/approaches"],
  ] as const)("expands the %s Template into its declared work zone", async (template, expected) => {
    const root = await temporary(`absorb-template-${template}`);
    await initFramework({ target: root, name: template, template });
    expect(await stat(path.join(root, ...expected.split("/")))).toBeTruthy();
    const manifest = await loadManifest(root);
    expect(
      manifest?.layout.entries.some(
        (entry) => entry.path === expected.replace(".absorb", ".assay"),
      ),
    ).toBe(true);
  });

  it("migrates the supported previous tuple through update and preserves Source usability", async () => {
    const root = await temporary("absorb-version-migrate");
    const input = await temporary("absorb-version-input");
    await writeFile(path.join(input, "evidence.txt"), "evidence\n", "utf8");
    await initFramework({ target: root, name: "migration", standalone: true });
    await addSource({ root, source: input, alias: "legacy-source" });

    const lineageFile = path.join(root, "sources", "legacy-source", "source.yaml");
    const lineage = parseYaml(await readFile(lineageFile, "utf8")) as Record<string, unknown>;
    const { content_mode: _contentMode, ...legacyLineage } = lineage;
    await writeFile(
      lineageFile,
      stringifyYaml({ ...legacyLineage, mode: "frozen", default_capture_mode: "archive" }),
      "utf8",
    );
    const manifestFile = path.join(root, ".absorb", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    manifest.framework_version = "0.13.0";
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const manifestBefore = await readFile(manifestFile, "utf8");
    const lineageBefore = await readFile(lineageFile, "utf8");
    const dryRun = await applyUpdate({ root, dryRun: true });
    expect(dryRun.migration?.changes).toContain(
      "rewrite source records: living|frozen modes become checkout|copy content",
    );
    expect(await readFile(manifestFile, "utf8")).toBe(manifestBefore);
    expect(await readFile(lineageFile, "utf8")).toBe(lineageBefore);
    await expect(stat(path.join(root, ".absorb", "coordination"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const result = await applyUpdate({ root });
    expect(result.migration).toMatchObject({ from: "0.13.0", to: "0.14.0" });
    expect((await loadManifest(root))?.framework_version).toBe("0.14.0");
    expect((await getSourceStatus({ root, alias: "legacy-source" })).sources[0]?.contentMode).toBe(
      "copy",
    );
  });

  it("installs and refreshes one managed AGENTS block while preserving owner text", async () => {
    const root = await temporary("absorb-agents");
    await writeFile(path.join(root, "AGENTS.md"), "# Owner instructions\n", "utf8");
    await initFramework({ target: root, name: "agents", standalone: true });
    const installed = await readFile(path.join(root, "AGENTS.md"), "utf8");
    expect(installed).toContain("# Owner instructions");
    expect(installed.match(new RegExp(ABSORB_AGENTS_START_MARKER, "g"))).toHaveLength(1);
    expect(installed).toContain("| `sources/` | External material and observation history |");

    await writeFile(
      path.join(root, "AGENTS.md"),
      installed.replace("# Absorb Workspace Instructions", "# stale managed copy"),
      "utf8",
    );
    await applyUpdate({ root, agents: true });
    const refreshed = await readFile(path.join(root, "AGENTS.md"), "utf8");
    expect(refreshed).toContain("# Owner instructions");
    expect(refreshed).toContain("# Absorb Workspace Instructions");
    expect(refreshed).toContain(ABSORB_AGENTS_END_MARKER);
  });
});
