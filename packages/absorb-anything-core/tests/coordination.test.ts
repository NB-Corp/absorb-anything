import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  migrateEnvelope,
  resolveEnvelopeContext,
  withEnvelopeMigrationCoordination,
  withWorkspaceMutationCoordination,
} from "../src/index.js";

const roots: string[] = [];

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function temporary(name: string): Promise<string> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), `${name}-`)),
  );
  roots.push(root);
  await mkdir(path.join(root, ".assay"));
  return root;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function expectPending(promise: Promise<unknown>): Promise<void> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(settled).toBe(false);
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("workspace mutation and envelope migration coordination", { timeout: 30_000 }, () => {
  it("keeps migration pending until a legacy-envelope core mutation finishes", async () => {
    const root = await temporary("absorb-core-before-migration");
    const acquired = deferred();
    const release = deferred();
    const mutation = withWorkspaceMutationCoordination(root, async () => {
      acquired.resolve();
      await release.promise;
      const context = await resolveEnvelopeContext(root);
      await writeFile(path.join(context.path, "core-writer.txt"), "core\n", "utf8");
    });
    await acquired.promise;

    const migration = migrateEnvelope(root);
    await expectPending(migration);
    expect(await exists(path.join(root, ".assay"))).toBe(true);
    expect(await exists(path.join(root, ".absorb"))).toBe(false);

    release.resolve();
    await mutation;
    expect((await migration).changed).toBe(true);
    expect(await readFile(path.join(root, ".absorb", "core-writer.txt"), "utf8")).toBe("core\n");
    expect(await exists(path.join(root, ".assay"))).toBe(false);
  });

  it("keeps core mutation pending until migration releases the renamed envelope", async () => {
    const root = await temporary("absorb-migration-before-core");
    const migrated = deferred();
    const release = deferred();
    const migration = withEnvelopeMigrationCoordination(root, async () => {
      const result = await migrateEnvelope(root);
      migrated.resolve();
      await release.promise;
      return result;
    });
    await migrated.promise;

    const mutation = withWorkspaceMutationCoordination(root, async () => {
      const context = await resolveEnvelopeContext(root);
      await writeFile(path.join(context.path, "post-migration.txt"), "preferred\n", "utf8");
      return context.directory;
    });
    await expectPending(mutation);
    expect(await exists(path.join(root, ".assay", "post-migration.txt"))).toBe(false);
    expect(await exists(path.join(root, ".absorb", "post-migration.txt"))).toBe(false);

    release.resolve();
    expect((await migration).changed).toBe(true);
    expect(await mutation).toBe(".absorb");
    expect(await readFile(path.join(root, ".absorb", "post-migration.txt"), "utf8")).toBe(
      "preferred\n",
    );
    expect(await exists(path.join(root, ".assay"))).toBe(false);
  });

  it("allows nested mutation and cleans coordination for a later writer", async () => {
    const root = await temporary("absorb-reentrant-coordination");

    await withWorkspaceMutationCoordination(root, () =>
      withWorkspaceMutationCoordination(root, async () => {
        const context = await resolveEnvelopeContext(root);
        await writeFile(path.join(context.path, "nested.txt"), "nested\n", "utf8");
      }),
    );
    expect(await exists(path.join(root, ".assay", "coordination"))).toBe(false);

    await withWorkspaceMutationCoordination(root, async () => {
      const context = await resolveEnvelopeContext(root);
      await writeFile(path.join(context.path, "later.txt"), "later\n", "utf8");
    });

    expect(await readFile(path.join(root, ".assay", "nested.txt"), "utf8")).toBe("nested\n");
    expect(await readFile(path.join(root, ".assay", "later.txt"), "utf8")).toBe("later\n");
    expect(await exists(path.join(root, ".assay", "coordination"))).toBe(false);
    expect(await exists(path.join(root, ".absorb-envelope-migration.lock"))).toBe(false);
  });
});
