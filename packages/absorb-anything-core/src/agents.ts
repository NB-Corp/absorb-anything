import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { safelyWriteAuthorityFile } from "./authority-file-write.js";
import { AuthorityWriteConflictError, FrameworkError } from "./errors.js";
import { loadManifest } from "./manifest.js";
import { SEMANTIC_TOPICS, semanticDigest, semanticDigestSentence } from "./semantics.js";
import { manifestZones, zoneTable } from "./zones.js";

export const ABSORB_AGENTS_FILE = "AGENTS.md";
export const ABSORB_AGENTS_START_MARKER = "<!-- ABSORB:START -->";
export const ABSORB_AGENTS_END_MARKER = "<!-- ABSORB:END -->";
export const ABSORB_AGENTS_MALFORMED_REASON =
  "AGENTS.md has incomplete Absorb managed block markers";

export type AbsorbAgentsBlockMode = "install" | "refresh-existing" | "skip";
export type AbsorbAgentsBlockAction = "create" | "append" | "replace" | "skip";
export interface AbsorbAgentsBlockPlan {
  readonly path: typeof ABSORB_AGENTS_FILE;
  readonly action: AbsorbAgentsBlockAction;
  readonly reason: string;
  readonly changed: boolean;
}
export interface AbsorbAgentsBlockResult extends AbsorbAgentsBlockPlan {
  readonly dryRun: boolean;
}
interface InternalPlan extends AbsorbAgentsBlockPlan {
  readonly content?: string;
  readonly expectedContent?: string | null;
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

export async function absorbAgentsBlock(root: string): Promise<string> {
  let table: string[] = [];
  try {
    const manifest = await loadManifest(root);
    if (manifest) table = zoneTable(manifestZones(manifest.layout.entries, manifest.layout));
  } catch {
    table = [];
  }
  return [
    ABSORB_AGENTS_START_MARKER,
    "",
    "# Absorb Workspace Instructions",
    "",
    "This workspace keeps external Sources, Analysis, and reusable Knowledge under one versioned envelope.",
    "",
    "- Run `absorb prime` at the start of a session.",
    `- Run \`absorb explain <object>\` before first use. Topics: ${SEMANTIC_TOPICS.join(", ")}.`,
    "- Use `absorb` commands for workspace state. Edits outside this block are preserved.",
    "",
    "## Object semantics",
    "",
    ...semanticDigest().map((entry) => `- ${semanticDigestSentence(entry)}`),
    ...(table.length > 0 ? ["", "## Workspace layout", "", ...table] : []),
    "",
    ABSORB_AGENTS_END_MARKER,
  ].join("\n");
}

function locate(content: string): { start: number; end: number } | "none" | "malformed" {
  const start = content.indexOf(ABSORB_AGENTS_START_MARKER);
  const anyEnd = content.includes(ABSORB_AGENTS_END_MARKER);
  if (start < 0) return anyEnd ? "malformed" : "none";
  const markerEnd = content.indexOf(ABSORB_AGENTS_END_MARKER, start);
  if (markerEnd < 0) return "malformed";
  let end = markerEnd + ABSORB_AGENTS_END_MARKER.length;
  if (content.startsWith("\r\n", end)) end += 2;
  else if (content.startsWith("\n", end)) end += 1;
  return { start, end };
}

async function plan(rootInput: string, mode: AbsorbAgentsBlockMode): Promise<InternalPlan> {
  const root = path.resolve(rootInput);
  if (mode === "skip") {
    return {
      path: ABSORB_AGENTS_FILE,
      action: "skip",
      reason: "agent instructions disabled",
      changed: false,
    };
  }
  const file = path.join(root, ABSORB_AGENTS_FILE);
  const existing = (await exists(file)) ? await readFile(file, "utf8") : null;
  const block = `${await absorbAgentsBlock(root)}\n`;
  if (existing === null) {
    return mode === "install"
      ? {
          path: ABSORB_AGENTS_FILE,
          action: "create",
          reason: "AGENTS.md is missing",
          changed: true,
          content: block,
          expectedContent: null,
        }
      : {
          path: ABSORB_AGENTS_FILE,
          action: "skip",
          reason: "AGENTS.md is missing",
          changed: false,
        };
  }
  const found = locate(existing);
  if (found === "malformed") {
    return {
      path: ABSORB_AGENTS_FILE,
      action: "skip",
      reason: ABSORB_AGENTS_MALFORMED_REASON,
      changed: false,
    };
  }
  if (found === "none") {
    if (mode !== "install") {
      return {
        path: ABSORB_AGENTS_FILE,
        action: "skip",
        reason: "AGENTS.md has no Absorb managed block",
        changed: false,
      };
    }
    const separator = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
    return {
      path: ABSORB_AGENTS_FILE,
      action: "append",
      reason: "install Absorb managed block",
      changed: true,
      content: `${existing}${separator}${block}`,
      expectedContent: existing,
    };
  }
  const next = `${existing.slice(0, found.start)}${block}${existing.slice(found.end)}`;
  return next === existing
    ? {
        path: ABSORB_AGENTS_FILE,
        action: "skip",
        reason: "Absorb managed block is current",
        changed: false,
      }
    : {
        path: ABSORB_AGENTS_FILE,
        action: "replace",
        reason: "refresh Absorb managed block",
        changed: true,
        content: next,
        expectedContent: existing,
      };
}

export async function planAbsorbAgentsBlock(options: {
  readonly root: string;
  readonly mode?: AbsorbAgentsBlockMode;
}): Promise<AbsorbAgentsBlockPlan> {
  const {
    content: _content,
    expectedContent: _expected,
    ...result
  } = await plan(options.root, options.mode ?? "install");
  return result;
}

export async function applyAbsorbAgentsBlock(options: {
  readonly root: string;
  readonly mode?: AbsorbAgentsBlockMode;
  readonly dryRun?: boolean;
}): Promise<AbsorbAgentsBlockResult> {
  const root = path.resolve(options.root);
  const candidate = await plan(root, options.mode ?? "install");
  const dryRun = options.dryRun ?? false;
  if (candidate.changed && !dryRun && candidate.content !== undefined) {
    await safelyWriteAuthorityFile({
      root,
      file: path.join(root, ABSORB_AGENTS_FILE),
      content: candidate.content,
      validateExisting: (bytes) => {
        const current = bytes?.toString("utf8") ?? null;
        if (current !== candidate.expectedContent) {
          throw new AuthorityWriteConflictError(
            "AGENTS.md changed after its managed block was planned",
          );
        }
      },
      error: (message, cause) => new FrameworkError(message, cause === undefined ? {} : { cause }),
      textFileMode: { preserveExisting: true, createMode: 0o666 },
    });
  }
  const { content: _content, expectedContent: _expected, ...publicPlan } = candidate;
  return { ...publicPlan, dryRun };
}

export function describeAbsorbAgentsBlockAction(result: AbsorbAgentsBlockResult): string {
  if (!result.changed) return `${ABSORB_AGENTS_FILE}: ${result.reason}`;
  if (result.dryRun) return `${ABSORB_AGENTS_FILE}: would ${result.action} Absorb managed block`;
  const past: Record<Exclude<AbsorbAgentsBlockAction, "skip">, string> = {
    create: "created",
    append: "appended",
    replace: "replaced",
  };
  return `${ABSORB_AGENTS_FILE}: ${result.action === "skip" ? result.reason : past[result.action]} Absorb managed block`;
}
