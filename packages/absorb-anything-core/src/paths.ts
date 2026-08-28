import { realpath as realpathWithCallback } from "node:fs";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { LEGACY_ENVELOPE_DIR, PREFERRED_ENVELOPE_DIR } from "./constants.js";
import { FrameworkAlreadyExistsError, FrameworkError } from "./errors.js";
import { loadManifest } from "./manifest.js";
import { toPosixPath } from "./serialization.js";

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

// The OS resolver, not the JS one: only it expands Windows 8.3 short names.
const realpathNative = promisify(realpathWithCallback.native);

async function canonicalPath(target: string): Promise<string> {
  const resolved = path.resolve(target);
  try {
    return await realpathNative(resolved);
  } catch {
    return resolved;
  }
}

/**
 * The home directory holds machine-local config (the clone registry), not a
 * workspace. Comparison must go through the real path: Windows hands out 8.3
 * short names (C:\Users\RUNNER~1) that never string-match the long home.
 */
async function isUserGlobalConfigRoot(root: string): Promise<boolean> {
  const [candidate, home] = await Promise.all([canonicalPath(root), canonicalPath(os.homedir())]);
  return candidate.toLowerCase() === home.toLowerCase();
}

export function relativeDisplayPath(targetPath: string, root: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(targetPath));
  if (relative === "") return ".";
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return toPosixPath(relative);
  return toPosixPath(targetPath);
}

export function isContainedPath(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(root, target));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export function resolveContainedPath(
  root: string,
  relativePath: string,
  label: string,
): { readonly absolutePath: string; readonly relativePath: string } {
  const normalized = toPosixPath(relativePath).replace(/^\.\//, "");
  const absolutePath = path.resolve(root, normalized);
  if (path.isAbsolute(normalized) || !isContainedPath(root, normalized)) {
    throw new FrameworkError(`${label} escapes the workspace: ${relativePath}`, {
      code: "IO_ERROR",
    });
  }
  return {
    absolutePath,
    relativePath: toPosixPath(path.relative(path.resolve(root), absolutePath)),
  };
}

export function slugify(text: string): string {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return value || "untitled";
}

/** Nearest physical envelope wins; a selected preferred envelope never falls back. */
export async function discoverFrameworkRoot(start: string): Promise<string> {
  const requested = path.resolve(start);
  let current = requested;
  if (await isFile(current)) current = path.dirname(current);
  const exact = current;
  while (true) {
    const preferred = path.join(current, PREFERRED_ENVELOPE_DIR);
    const legacy = path.join(current, LEGACY_ENVELOPE_DIR);
    if (
      (await exists(preferred)) &&
      !(
        (await isUserGlobalConfigRoot(current)) &&
        !(await exists(path.join(preferred, "manifest.json")))
      )
    ) {
      await loadManifest(current);
      return current;
    }
    if (
      (await exists(legacy)) &&
      !(
        (await isUserGlobalConfigRoot(current)) &&
        !(await exists(path.join(legacy, "manifest.json")))
      )
    ) {
      await loadManifest(current);
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(start);
}

export async function assertNoAncestorWorkspaceAuthority(target: string): Promise<void> {
  let candidate = path.dirname(path.resolve(target));
  while (true) {
    if (
      ((await exists(path.join(candidate, PREFERRED_ENVELOPE_DIR))) &&
        !(
          (await isUserGlobalConfigRoot(candidate)) &&
          !(await exists(path.join(candidate, PREFERRED_ENVELOPE_DIR, "manifest.json")))
        )) ||
      ((await exists(path.join(candidate, LEGACY_ENVELOPE_DIR))) &&
        !(
          (await isUserGlobalConfigRoot(candidate)) &&
          !(await exists(path.join(candidate, LEGACY_ENVELOPE_DIR, "manifest.json")))
        ))
    ) {
      await loadManifest(candidate);
      throw new FrameworkAlreadyExistsError(
        `Target is nested under an existing workspace: ${candidate}`,
      );
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
}
