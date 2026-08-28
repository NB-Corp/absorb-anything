import { lstat, rename } from "node:fs/promises";
import path from "node:path";

import { LEGACY_ENVELOPE_DIR, PREFERRED_ENVELOPE_DIR } from "./constants.js";
import { FrameworkError, FrameworkNotFoundError } from "./errors.js";

export type EnvelopeDirectory = typeof PREFERRED_ENVELOPE_DIR | typeof LEGACY_ENVELOPE_DIR;

async function directoryState(target: string): Promise<"missing" | "directory" | "invalid"> {
  try {
    const info = await lstat(target);
    return info.isDirectory() && !info.isSymbolicLink() ? "directory" : "invalid";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "missing";
    throw error;
  }
}

export interface EnvelopeContext {
  readonly root: string;
  readonly directory: EnvelopeDirectory;
  readonly path: string;
  readonly exists: boolean;
}

/** Select one physical envelope. Presence of the preferred name always wins. */
export async function resolveEnvelopeContext(rootInput: string): Promise<EnvelopeContext> {
  const root = path.resolve(rootInput);
  const preferredPath = path.join(root, PREFERRED_ENVELOPE_DIR);
  const preferred = await directoryState(preferredPath);
  if (preferred !== "missing") {
    if (preferred !== "directory") {
      throw new FrameworkError(`Envelope path is not a real directory: ${preferredPath}`);
    }
    return { root, directory: PREFERRED_ENVELOPE_DIR, path: preferredPath, exists: true };
  }
  const legacyPath = path.join(root, LEGACY_ENVELOPE_DIR);
  const legacy = await directoryState(legacyPath);
  if (legacy !== "missing") {
    if (legacy !== "directory") {
      throw new FrameworkError(`Envelope path is not a real directory: ${legacyPath}`);
    }
    return { root, directory: LEGACY_ENVELOPE_DIR, path: legacyPath, exists: true };
  }
  return { root, directory: PREFERRED_ENVELOPE_DIR, path: preferredPath, exists: false };
}

export function projectLogicalPath(relativePath: string, directory: EnvelopeDirectory): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized === LEGACY_ENVELOPE_DIR) return directory;
  if (normalized.startsWith(`${LEGACY_ENVELOPE_DIR}/`)) {
    return `${directory}${normalized.slice(LEGACY_ENVELOPE_DIR.length)}`;
  }
  return normalized;
}

export interface EnvelopeMigrationResult {
  readonly root: string;
  readonly changed: boolean;
  readonly from: string;
  readonly to: string;
}

/** Rename-only envelope migration. It intentionally writes no event or receipt. */
export async function migrateEnvelopeUncoordinated(
  rootInput: string,
): Promise<EnvelopeMigrationResult> {
  const root = path.resolve(rootInput);
  const preferred = path.join(root, PREFERRED_ENVELOPE_DIR);
  const legacy = path.join(root, LEGACY_ENVELOPE_DIR);
  const [preferredState, legacyState] = await Promise.all([
    directoryState(preferred),
    directoryState(legacy),
  ]);
  if (preferredState !== "missing" && preferredState !== "directory") {
    throw new FrameworkError(`Envelope path is not a real directory: ${preferred}`);
  }
  if (legacyState !== "missing" && legacyState !== "directory") {
    throw new FrameworkError(`Envelope path is not a real directory: ${legacy}`);
  }
  if (preferredState === "directory" && legacyState === "directory") {
    throw new FrameworkError(
      `Both ${PREFERRED_ENVELOPE_DIR} and ${LEGACY_ENVELOPE_DIR} exist; migration requires exactly one envelope.`,
    );
  }
  if (preferredState === "directory") {
    return { root, changed: false, from: legacy, to: preferred };
  }
  if (legacyState === "missing") {
    throw new FrameworkNotFoundError(`No envelope found under ${root}.`);
  }
  await rename(legacy, preferred);
  return { root, changed: true, from: legacy, to: preferred };
}
