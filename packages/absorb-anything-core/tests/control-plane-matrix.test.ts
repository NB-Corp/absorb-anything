import { link, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyUpdate,
  checkFramework,
  getFrameworkStatus,
  initFramework,
  listAvailableTemplates,
  loadManagedFiles,
  loadManifest,
  loadTemplate,
} from "../src/index.js";

const roots: string[] = [];

async function temporary(name: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `${name}-`));
  roots.push(root);
  return root;
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    },
  );
}

async function customTemplate(parent: string, content = "custom output\n"): Promise<string> {
  const file = path.join(parent, "custom.yaml");
  await writeFile(
    file,
    [
      "__schema: 1",
      "description: Explicit custom template.",
      "directories:",
      "  - path: custom",
      "    purpose: User-owned custom material",
      "files:",
      "  - path: custom/output.txt",
      `    content: ${JSON.stringify(content)}`,
      "",
    ].join("\n"),
    "utf8",
  );
  return file;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("template control plane", () => {
  it("exposes exactly three built-ins and requires an explicit strict YAML path", async () => {
    expect((await listAvailableTemplates()).map((entry) => entry.name)).toEqual([
      "study",
      "solve",
      "explore",
    ]);
    await expect(loadTemplate("custom-name")).rejects.toThrow("explicit YAML path");
    const parent = await temporary("absorb-control-strict");
    const descriptor = path.join(parent, "bad.yaml");
    await writeFile(
      descriptor,
      "__schema: 1\ndescription: bad\nextends: base\ndirectories: []\nfiles: []\n",
      "utf8",
    );
    const target = path.join(parent, "workspace");
    await expect(initFramework({ target, template: descriptor })).rejects.toThrow(
      "unsupported field(s): extends",
    );
    expect(await exists(target)).toBe(false);
  });

  it("rejects legacy fields and unsafe paths before the first scaffold write", async () => {
    const parent = await temporary("absorb-control-negative");
    for (const field of [
      "extends",
      "mode",
      "dirs_required",
      "dirs_optional",
      "modules",
      "templateId",
    ]) {
      const descriptor = path.join(parent, `${field}.yaml`);
      await writeFile(
        descriptor,
        `__schema: 1\ndescription: bad\n${field}: legacy\ndirectories: []\nfiles: []\n`,
        "utf8",
      );
      await expect(loadTemplate(descriptor)).rejects.toThrow("unsupported field");
    }
    for (const [name, unsafePath] of [
      ["absolute", "C:/outside"],
      ["traversal", "../outside"],
      ["retired", "iterations/old"],
      ["native-project", "project/project.yaml"],
      ["native-root", "project"],
      ["managed-core", "README.md"],
      ["manifest-authority", ".assay/manifest.json"],
      ["receipt-authority", ".assay/managed-files.json"],
      ["tasks-root", "tasks/item.json"],
      ["systems-root", "systems/root.yaml"],
    ] as const) {
      const descriptor = path.join(parent, `${name}.yaml`);
      await writeFile(
        descriptor,
        `__schema: 1\ndescription: bad\ndirectories:\n  - path: ${unsafePath}\n    purpose: bad\nfiles: []\n`,
        "utf8",
      );
      const target = path.join(parent, `target-${name}`);
      await expect(initFramework({ target, template: descriptor })).rejects.toThrow(
        /template path|retired/,
      );
      expect(await exists(target)).toBe(false);
    }
    await writeFile(path.join(parent, "outside.txt"), "outside\n", "utf8");
    const nested = path.join(parent, "nested");
    await mkdir(nested);
    const escaped = path.join(nested, "escaped.yaml");
    await writeFile(
      escaped,
      "__schema: 1\ndescription: bad\ndirectories: []\nfiles:\n  - path: safe.txt\n    file: ../outside.txt\n",
      "utf8",
    );
    await expect(loadTemplate(escaped)).rejects.toThrow("escapes its descriptor directory");
  });

  it("persists expanded entries and leaves custom output outside the managed receipt", async () => {
    const parent = await temporary("absorb-control-custom");
    const root = path.join(parent, "workspace");
    const descriptor = await customTemplate(parent);
    await initFramework({ target: root, name: "Custom", template: descriptor, agents: false });
    await rm(descriptor);

    const manifest = await loadManifest(root);
    expect(manifest).toMatchObject({
      __schema: 4,
      framework_version: "0.14.0",
      layout: {
        version: 8,
        entries: [
          { path: ".assay/custom", kind: "directory" },
          { path: ".assay/custom/output.txt", kind: "file" },
        ],
      },
    });
    expect(JSON.stringify(manifest)).not.toMatch(/template|archetype|profile|managed_files/);
    expect(
      (await loadManagedFiles(root)).files.some((entry) => entry.path.includes("custom")),
    ).toBe(false);
    expect(await readFile(path.join(root, ".absorb", "custom", "output.txt"), "utf8")).toBe(
      "custom output\n",
    );
    await expect(getFrameworkStatus({ root })).resolves.toMatchObject({ project: "Custom" });
    await expect(checkFramework({ root })).resolves.toMatchObject({ ok: true });
    await expect(applyUpdate({ root, dryRun: true })).resolves.toMatchObject({ dryRun: true });
  });
});

describe("managed authority and observation control plane", () => {
  it("fails closed on missing, malformed, and shared managed receipts without writes", async () => {
    const parent = await temporary("absorb-control-receipt");
    const missing = path.join(parent, "missing");
    await initFramework({ target: missing, name: "Missing", agents: false });
    const missingReceipt = path.join(missing, ".absorb", "managed-files.json");
    await rm(missingReceipt);
    await expect(loadManagedFiles(missing)).rejects.toThrow("Managed receipt is missing");

    const malformed = path.join(parent, "malformed");
    await initFramework({ target: malformed, name: "Malformed", agents: false });
    const malformedReceipt = path.join(malformed, ".absorb", "managed-files.json");
    await writeFile(malformedReceipt, '{"__schema":1,"files":"bad"}', "utf8");
    const malformedEntries = await readdir(path.join(malformed, ".absorb"));
    await expect(applyUpdate({ root: malformed })).rejects.toThrow("failed validation");
    expect(await readdir(path.join(malformed, ".absorb"))).toEqual(malformedEntries);
    expect(await readFile(malformedReceipt, "utf8")).toBe('{"__schema":1,"files":"bad"}');

    const shared = path.join(parent, "shared");
    await initFramework({ target: shared, name: "Shared", agents: false });
    const sharedReceipt = path.join(shared, ".absorb", "managed-files.json");
    const outside = path.join(parent, "outside-receipt.json");
    await writeFile(outside, await readFile(sharedReceipt));
    await rm(sharedReceipt);
    await link(outside, sharedReceipt);
    const sharedEntries = await readdir(path.join(shared, ".absorb"));
    await expect(applyUpdate({ root: shared })).rejects.toThrow("unshared file");
    expect(await readdir(path.join(shared, ".absorb"))).toEqual(sharedEntries);
    expect(await readFile(outside)).toEqual(await readFile(sharedReceipt));
  });

  it("keeps read commands event-free", async () => {
    const root = await temporary("absorb-control-events");
    await initFramework({ target: root, name: "Events", agents: false });
    const eventsDir = path.join(root, ".absorb", "events");
    const beforeNames = (await readdir(eventsDir)).sort();
    const beforeBytes = await Promise.all(
      beforeNames.map(async (name) => [name, await readFile(path.join(eventsDir, name))] as const),
    );

    await getFrameworkStatus({ root });
    await checkFramework({ root });

    expect((await readdir(eventsDir)).sort()).toEqual(beforeNames);
    for (const [name, bytes] of beforeBytes) {
      expect(await readFile(path.join(eventsDir, name))).toEqual(bytes);
    }
  });
});
