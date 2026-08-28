import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { applyAbsorbAgentsBlock } from "./agents.js";
import { safelyWriteAuthorityFile } from "./authority-file-write.js";
import { withWorkspaceMutationCoordination } from "./coordination.js";
import { AuthorityWriteConflictError, FrameworkNotFoundError } from "./errors.js";
import { appendEvent } from "./events.js";
import { computeHash } from "./hashing.js";
import { workspacePhysicalRelativePath } from "./layout.js";
import { loadManagedFiles, managedFileRecord, saveManagedFiles } from "./managed-files.js";
import { loadManifest } from "./manifest.js";
import {
  type WorkspaceMigrationResult,
  analyzeWorkspaceMigration,
  applyWorkspaceMigration,
} from "./migrate.js";
import { loadNativeProject } from "./project.js";
import type { ManagedFileRecord } from "./schemas/index.js";
import { baseCoreTemplates } from "./templates.js";

export type UpdateConflictAction = "skip" | "force" | "create-new";
export interface UpdateChange {
  readonly path: string;
  readonly kind: "new" | "auto-update" | "modified-by-user" | "user-deleted" | "unchanged";
  readonly action: "create" | "update" | "skip" | "force" | "create-new";
}
export interface ApplyUpdateResult {
  readonly root: string;
  readonly dryRun: boolean;
  readonly action: UpdateConflictAction;
  readonly changes: readonly UpdateChange[];
  readonly preservedUnknownRecords: number;
  readonly eventFile?: string;
  readonly migration?: WorkspaceMigrationResult;
}

export interface UpdatePlanProbeEntry {
  readonly path: string;
  readonly physicalPath: string;
  readonly action: UpdateChange["action"];
  readonly expectedExists: boolean;
  readonly expectedHash?: string;
}
export type UpdatePlanProbe = (
  root: string,
  entries: readonly UpdatePlanProbeEntry[],
) => void | Promise<void>;
let updatePlanProbe: UpdatePlanProbe | undefined;

export function setUpdatePlanProbeForTests(probe: UpdatePlanProbe | undefined): void {
  updatePlanProbe = probe;
}

async function fileState(
  file: string,
): Promise<{ readonly exists: boolean; readonly hash?: string }> {
  try {
    const info = await stat(file);
    if (!info.isFile()) return { exists: true };
    return { exists: true, hash: computeHash(await readFile(file, "utf8")) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { exists: false };
    throw error;
  }
}

export interface ApplyUpdateOptions {
  readonly root: string;
  readonly dryRun?: boolean;
  readonly action?: UpdateConflictAction;
  readonly agents?: boolean;
}

async function applyUpdateUnlocked(options: ApplyUpdateOptions): Promise<ApplyUpdateResult> {
  const root = path.resolve(options.root);
  const migrationAnalysis = await analyzeWorkspaceMigration(root);
  if (options.dryRun && migrationAnalysis.required) {
    return {
      root,
      dryRun: true,
      action: options.action ?? "skip",
      changes: [],
      preservedUnknownRecords: 0,
      migration: {
        root,
        from: migrationAnalysis.from,
        to: migrationAnalysis.to,
        changes: migrationAnalysis.steps.map((step) => step.summary),
      },
    };
  }
  const migration = migrationAnalysis.required
    ? await applyWorkspaceMigration({ root })
    : undefined;
  const manifest = await loadManifest(root);
  if (!manifest) throw new FrameworkNotFoundError(`No workspace manifest found under ${root}.`);
  const project = await loadNativeProject(root, manifest.layout);
  if (!project) throw new FrameworkNotFoundError("Project identity is missing.");
  const receipt = await loadManagedFiles(root);
  const templates = baseCoreTemplates(project.name, manifest.layout);
  const desired = new Map(templates.map((template) => [template.path, template]));
  const records = new Map(receipt.files.map((record) => [record.path, record]));
  const changes: UpdateChange[] = [];
  const planned: UpdatePlanProbeEntry[] = [];
  const action = options.action ?? "skip";
  const sidecars: string[] = [];
  for (const template of templates) {
    const physical = workspacePhysicalRelativePath(manifest.layout, template.path);
    const state = await fileState(path.join(root, physical));
    const record = records.get(template.path);
    const desiredHash = computeHash(template.content);
    let kind: UpdateChange["kind"];
    let selected: UpdateChange["action"];
    if (!state.exists) {
      kind = record ? "user-deleted" : "new";
      selected = record ? "skip" : "create";
    } else if (state.hash === desiredHash) {
      kind = "unchanged";
      selected = "skip";
    } else if (record && state.hash === record.baseline_hash) {
      kind = "auto-update";
      selected = "update";
    } else {
      kind = "modified-by-user";
      selected = action;
    }
    changes.push({ path: template.path, kind, action: selected });
    planned.push({
      path: template.path,
      physicalPath: physical,
      action: selected,
      expectedExists: state.exists,
      ...(state.hash ? { expectedHash: state.hash } : {}),
    });
    if (selected === "create-new") sidecars.push(`${path.join(root, physical)}.new`);
  }
  await updatePlanProbe?.(root, planned);
  // The plan is all-or-nothing for sidecars. Detect every collision before any
  // managed file is touched, then the CAS writer below independently enforces
  // non-existence at the write boundary.
  for (const sidecar of sidecars) {
    if ((await fileState(sidecar)).exists) {
      throw new AuthorityWriteConflictError(`update sidecar already exists: ${sidecar}`);
    }
  }
  // Validate the complete mutating set before the first write. The authority
  // writer repeats the same condition at each individual rename boundary.
  for (const entry of planned) {
    if (!["create", "update", "force"].includes(entry.action)) continue;
    const current = await fileState(path.join(root, entry.physicalPath));
    if (current.exists !== entry.expectedExists || current.hash !== entry.expectedHash) {
      throw new AuthorityWriteConflictError(
        `managed file changed after update planning: ${entry.path}`,
      );
    }
  }
  for (const [index, template] of templates.entries()) {
    const selected = changes[index]?.action ?? "skip";
    if (options.dryRun || selected === "skip") continue;
    const physical = workspacePhysicalRelativePath(manifest.layout, template.path);
    const target = path.join(root, physical);
    const writeTarget = selected === "create-new" ? `${target}.new` : target;
    await mkdir(path.dirname(writeTarget), { recursive: true });
    if (selected === "create-new") {
      await safelyWriteAuthorityFile({
        root,
        file: writeTarget,
        content: template.content,
        validateExisting: (bytes) => {
          if (bytes !== null) {
            throw new AuthorityWriteConflictError(`update sidecar already exists: ${writeTarget}`);
          }
        },
        error: (message, cause) => new AuthorityWriteConflictError(message, cause),
        textFileMode: { preserveExisting: true, createMode: 0o666 },
      });
    } else {
      const expected = planned[index];
      await safelyWriteAuthorityFile({
        root,
        file: writeTarget,
        content: template.content,
        validateExisting: (bytes) => {
          const currentExists = bytes !== null;
          const currentHash = bytes ? computeHash(bytes.toString("utf8")) : undefined;
          if (
            !expected ||
            currentExists !== expected.expectedExists ||
            currentHash !== expected.expectedHash
          ) {
            throw new AuthorityWriteConflictError(
              `managed file changed after update planning: ${template.path}`,
            );
          }
        },
        error: (message, cause) => new AuthorityWriteConflictError(message, cause),
        textFileMode: {
          preserveExisting: true,
          createMode: template.executable ? 0o777 : 0o666,
        },
      });
    }
    if (selected !== "create-new") records.set(template.path, managedFileRecord(template));
  }
  const preservedUnknownRecords = receipt.files.filter(
    (record) => !desired.has(record.path),
  ).length;
  if (!options.dryRun) {
    await applyAbsorbAgentsBlock({
      root,
      mode: options.agents ? "install" : "refresh-existing",
    });
    const next = { __schema: 1 as const, files: [...records.values()] as ManagedFileRecord[] };
    await saveManagedFiles(root, next);
    const eventFile = await appendEvent(root, {
      event: "framework.updated",
      action,
      changed: changes.filter((change) => change.action !== "skip").map((change) => change.path),
      preserved_unknown_records: preservedUnknownRecords,
    });
    return {
      root,
      dryRun: false,
      action,
      changes,
      preservedUnknownRecords,
      eventFile,
      ...(migration ? { migration } : {}),
    };
  }
  return {
    root,
    dryRun: true,
    action,
    changes,
    preservedUnknownRecords,
    ...(migration ? { migration } : {}),
  };
}

export async function applyUpdate(options: ApplyUpdateOptions): Promise<ApplyUpdateResult> {
  const root = path.resolve(options.root);
  if (options.dryRun) return applyUpdateUnlocked({ ...options, root });
  return withWorkspaceMutationCoordination(root, () => applyUpdateUnlocked({ ...options, root }));
}
