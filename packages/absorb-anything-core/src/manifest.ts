import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { safelyWriteAuthorityFile } from "./authority-file-write.js";
import { CURRENT_VERSION, LAYOUT_VERSION } from "./constants.js";
import { type EnvelopeDirectory, resolveEnvelopeContext } from "./envelope.js";
import { InvalidManifestError, WorkspaceCutoverRequiredError } from "./errors.js";
import { bindWorkspaceEnvelope, defaultStandaloneLayout } from "./layout.js";
import {
  type FrameworkManifest,
  type ManifestEntry,
  frameworkManifestSchema,
} from "./schemas/index.js";
import { stringifySortedJson } from "./serialization.js";

export async function manifestPath(root: string): Promise<string> {
  const context = await resolveEnvelopeContext(root);
  return path.join(context.path, "manifest.json");
}

export function defaultManifest(
  entries: readonly ManifestEntry[] = [],
  directory: EnvelopeDirectory = ".absorb",
): FrameworkManifest {
  const layout = defaultStandaloneLayout(directory);
  layout.entries = [...entries];
  return { __schema: 4, framework_version: CURRENT_VERSION, layout };
}

function observedTuple(data: unknown, location = ""): string {
  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const layout =
    record.layout && typeof record.layout === "object" && !Array.isArray(record.layout)
      ? (record.layout as Record<string, unknown>)
      : {};
  const version =
    typeof record.framework_version === "string" ? record.framework_version : "unknown";
  const schema = typeof record.__schema === "number" ? record.__schema : "unknown";
  const layoutVersion = typeof layout.version === "number" ? layout.version : "unknown";
  const tuple = `${version}+s${schema}+l${layoutVersion}`;
  return location ? `${location}:${tuple}` : tuple;
}

function parseManifest(
  data: unknown,
  file: string,
  directory: EnvelopeDirectory,
): FrameworkManifest {
  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const layout =
    record?.layout && typeof record.layout === "object" && !Array.isArray(record.layout)
      ? (record.layout as Record<string, unknown>)
      : null;
  if (
    record?.framework_version !== CURRENT_VERSION ||
    record?.__schema !== 4 ||
    layout?.version !== LAYOUT_VERSION
  ) {
    throw new WorkspaceCutoverRequiredError(observedTuple(data, directory));
  }
  const result = frameworkManifestSchema.safeParse(data);
  if (!result.success) {
    throw new InvalidManifestError(file, "Framework manifest failed validation.", {
      details: result.error.flatten(),
      cause: result.error,
    });
  }
  bindWorkspaceEnvelope(result.data.layout, directory);
  return result.data;
}

export async function loadManifest(root: string): Promise<FrameworkManifest | null> {
  const context = await resolveEnvelopeContext(root);
  if (!context.exists) return null;
  const file = path.join(context.path, "manifest.json");
  let raw: string;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new InvalidManifestError(file, "Framework manifest must be an ordinary file.");
    }
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof InvalidManifestError) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new InvalidManifestError(file, "Selected envelope is missing manifest.json.");
    }
    throw error;
  }
  try {
    return parseManifest(JSON.parse(raw), file, context.directory);
  } catch (error) {
    if (error instanceof InvalidManifestError || error instanceof WorkspaceCutoverRequiredError)
      throw error;
    throw new InvalidManifestError(file, "Framework manifest is not valid JSON.", { cause: error });
  }
}

export async function saveManifest(
  root: string,
  manifest: FrameworkManifest,
): Promise<FrameworkManifest> {
  const context = await resolveEnvelopeContext(root);
  const file = path.join(context.path, "manifest.json");
  const logical = frameworkManifestSchema.parse(manifest);
  await safelyWriteAuthorityFile({
    root,
    file,
    content: stringifySortedJson(logical),
    validateExisting: (bytes) => {
      if (!bytes) return;
      let data: unknown;
      try {
        data = JSON.parse(bytes.toString("utf8"));
      } catch (error) {
        throw new InvalidManifestError(file, "Framework manifest is not valid JSON.", {
          cause: error,
        });
      }
      parseManifest(data, file, context.directory);
    },
    error: (message, cause) =>
      new InvalidManifestError(file, message, cause === undefined ? {} : { cause }),
  });
  bindWorkspaceEnvelope(logical.layout, context.directory);
  return logical;
}
