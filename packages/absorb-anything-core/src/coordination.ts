import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";

import { resolveEnvelopeContext } from "./envelope.js";
import { FrameworkError } from "./errors.js";

const held = new AsyncLocalStorage<ReadonlySet<string>>();
const WAIT_MS = 10_000;
const STALE_MS = 5 * 60_000;

function keyFor(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function authorityKey(kind: "envelope-migration" | "workspace-mutation", root: string): string {
  return `${kind}:${keyFor(root)}`;
}

async function tryAcquire(lock: string, token: string): Promise<boolean> {
  try {
    await mkdir(lock);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }
  const handle = await open(path.join(lock, "owner.json"), "wx", 0o600);
  try {
    await handle.writeFile(
      `${JSON.stringify({ token, pid: process.pid, created_at: new Date().toISOString() })}\n`,
      "utf8",
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

async function stale(lock: string): Promise<boolean> {
  try {
    const info = await stat(lock);
    if (Date.now() - info.mtimeMs < STALE_MS) return false;
    const owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")) as {
      pid?: unknown;
    };
    if (!Number.isSafeInteger(owner.pid)) return false;
    try {
      process.kill(owner.pid as number, 0);
      return false;
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "ESRCH";
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function withCoordinationLock<T>(lock: string, callback: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const deadline = Date.now() + WAIT_MS;
  let acquired = false;
  while (!acquired) {
    await mkdir(path.dirname(lock), { recursive: true });
    try {
      acquired = await tryAcquire(lock, token);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    if (acquired) break;
    if (await stale(lock)) {
      await rm(lock, { recursive: true, force: true });
      continue;
    }
    if (Date.now() >= deadline) throw new FrameworkError(`Coordination lock is held: ${lock}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  let outcome:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown };
  try {
    outcome = { ok: true, value: await callback() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  const owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")) as {
    token?: unknown;
  };
  if (owner.token !== token)
    throw new FrameworkError(`Coordination lock ownership changed: ${lock}`);
  await rm(lock, { recursive: true, force: true });
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

async function withReentrantCoordination<T>(
  authority: string,
  lock: string,
  callback: () => Promise<T>,
): Promise<T> {
  const current = held.getStore();
  if (current?.has(authority)) return callback();
  return withCoordinationLock(lock, () =>
    held.run(new Set([...(current ?? []), authority]), callback),
  );
}

/** Serialize writers from both products without importing object-specific storage. */
export async function withWorkspaceMutationCoordination<T>(
  rootInput: string,
  callback: () => Promise<T>,
): Promise<T> {
  const root = path.resolve(rootInput);
  return withEnvelopeMigrationCoordination(root, async () => {
    const context = await resolveEnvelopeContext(root);
    const coordination = path.join(context.path, "coordination");
    await mkdir(coordination, { recursive: true });
    const lock = path.join(coordination, "workspace-mutation");
    try {
      return await withReentrantCoordination(
        authorityKey("workspace-mutation", root),
        lock,
        callback,
      );
    } finally {
      await rmdir(coordination).catch((error: unknown) => {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error.code))
          )
        )
          throw error;
      });
    }
  });
}

/** Coordinate a rename without placing transient state inside either envelope tree. */
export async function withEnvelopeMigrationCoordination<T>(
  rootInput: string,
  callback: () => Promise<T>,
): Promise<T> {
  const root = path.resolve(rootInput);
  return withReentrantCoordination(
    authorityKey("envelope-migration", root),
    path.join(root, ".absorb-envelope-migration.lock"),
    callback,
  );
}
