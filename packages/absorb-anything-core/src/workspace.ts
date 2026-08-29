import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import {
  ABSORB_AGENTS_FILE,
  ABSORB_AGENTS_MALFORMED_REASON,
  applyAbsorbAgentsBlock,
  planAbsorbAgentsBlock,
} from "./agents.js";
import { PREFERRED_ENVELOPE_DIR } from "./constants.js";
import { type EnvelopeDirectory, resolveEnvelopeContext } from "./envelope.js";
import { FrameworkAlreadyExistsError, FrameworkError, FrameworkNotFoundError } from "./errors.js";
import { appendEvent } from "./events.js";
import {
  defaultOverlayLayout,
  defaultStandaloneLayout,
  workspacePhysicalRelativePath,
  workspaceRelativePath,
  workspaceSubpath,
} from "./layout.js";
import { loadManagedFiles, receiptForTemplates, saveManagedFiles } from "./managed-files.js";
import { defaultManifest, loadManifest, saveManifest } from "./manifest.js";
import {
  assertNoAncestorWorkspaceAuthority,
  relativeDisplayPath,
  resolveContainedPath,
  slugify,
} from "./paths.js";
import {
  ensureNativeProject,
  loadNativeProject,
  projectFileRelativePath,
  projectRootRelativePath,
  validateNativeProjectStructure,
} from "./project.js";
import { type CheckRow, type OperationReport, createEmptyReport } from "./results.js";
import type { FrameworkManifest, WorkspaceLayout, WorkspacePrivacy } from "./schemas/index.js";
import { evidencePinSuggestion } from "./semantics.js";
import { collectSourceHealthRows, getSourceStatus, resolveSourceObservation } from "./sources.js";
import { assertTemplateWriteBoundary, loadTemplate } from "./template.js";
import { baseCoreTemplates, expandTemplate, manifestEntriesForScaffold } from "./templates.js";
import { readUtf8File } from "./utf8.js";
import { manifestZones } from "./zones.js";

export interface InitFrameworkOptions {
  readonly target: string;
  readonly name?: string;
  readonly git?: boolean;
  readonly force?: boolean;
  readonly createNew?: boolean;
  readonly standalone?: boolean;
  readonly privacy?: WorkspacePrivacy;
  readonly template?: string;
  readonly agents?: boolean;
  /**
   * Physical envelope directory to create. Library callers that own `.assay` as
   * their native envelope pass it here; the absorb CLI always uses the
   * preferred name and exposes no flag for this.
   */
  readonly envelope?: EnvelopeDirectory;
}

export interface InitFrameworkResult {
  readonly root: string;
  readonly project: string;
  readonly template: string;
  readonly mode: "overlay" | "standalone";
  readonly report: OperationReport;
}

export interface CheckFrameworkResult {
  readonly root: string;
  readonly ok: boolean;
  readonly rows: CheckRow[];
  readonly manifest?: {
    readonly schema: number;
    readonly frameworkVersion: string;
    readonly format: string;
    readonly managedFiles: number;
  };
}

export interface FrameworkStatusResult {
  readonly root: string;
  readonly hasManifest: boolean;
  readonly installedVersion?: string;
  readonly layoutVersion?: number;
  readonly manifestFormat?: string;
  readonly envelope?: string;
  readonly project?: string;
  readonly nativeProject?: {
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly authority: string;
  };
  readonly managedFiles: number;
  readonly primarySystem?: { readonly path: "."; readonly implicit: true };
  readonly sources?: {
    readonly total: number;
    readonly checkouts: number;
    readonly copies: number;
    readonly majorChanges: number;
    readonly references: number;
    readonly brokenReferences: number;
  };
  readonly knowledgeEntries?: number;
  readonly zones?: readonly FrameworkZoneCount[];
}

export interface FrameworkZoneCount {
  readonly path: string;
  readonly files: number;
  readonly purpose: string;
}

export interface CreateAnalysisOptions {
  readonly root: string;
  readonly title: string;
  readonly forSource?: string;
  readonly observation?: string;
  readonly now?: Date;
}
export interface CreateAnalysisResult {
  readonly root: string;
  readonly path: string;
  readonly absolutePath: string;
  readonly eventFile: string;
}
export type AnalysisExit = "adopt" | "reject" | "experiment";
export interface CloseAnalysisOptions {
  readonly root: string;
  readonly path: string;
  readonly exit: AnalysisExit;
  readonly note?: string;
  readonly now?: Date;
}
export interface CloseAnalysisResult {
  readonly root: string;
  readonly path: string;
  readonly eventFile: string;
  readonly pinSuggestion?: string;
}
export type KnowledgeType = "pattern" | "guide" | "troubleshooting";
export interface AddKnowledgeOptions {
  readonly root: string;
  readonly type: KnowledgeType;
  readonly title: string;
  readonly fromAnalysis?: string;
  readonly now?: Date;
}
export interface AddKnowledgeResult {
  readonly root: string;
  readonly path: string;
  readonly eventFile: string;
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

async function ensureDir(target: string, root: string, report: OperationReport): Promise<void> {
  const display = relativeDisplayPath(target, root);
  if (await exists(target)) {
    report.existing_dirs.push(display);
    return;
  }
  await mkdir(target, { recursive: true });
  report.created_dirs.push(display);
}

function requireManifest(manifest: FrameworkManifest | null, root: string): FrameworkManifest {
  if (!manifest) throw new FrameworkNotFoundError(`No workspace manifest found under ${root}.`);
  return manifest;
}

async function writeTemplateFile(
  root: string,
  layout: WorkspaceLayout,
  logicalPath: string,
  content: string,
  report: OperationReport,
  options: { readonly force: boolean; readonly createNew: boolean; readonly executable: boolean },
): Promise<"written" | "skipped" | "new-copy"> {
  const physical = workspacePhysicalRelativePath(layout, logicalPath);
  const absolute = path.join(root, physical);
  await mkdir(path.dirname(absolute), { recursive: true });
  if ((await exists(absolute)) && !options.force) {
    if (options.createNew) {
      await writeFile(`${absolute}.new`, content, "utf8");
      report.new_copies.push(`${physical}.new`);
      return "new-copy";
    }
    report.skipped_files.push(physical);
    return "skipped";
  }
  const existed = await exists(absolute);
  await writeFile(absolute, content, "utf8");
  if (options.executable) await chmod(absolute, (await stat(absolute)).mode | 0o755);
  (existed ? report.updated_files : report.created_files).push(physical);
  return "written";
}

export async function initFramework(options: InitFrameworkOptions): Promise<InitFrameworkResult> {
  const root = path.resolve(options.target);
  await assertNoAncestorWorkspaceAuthority(root);
  if (await loadManifest(root))
    throw new FrameworkAlreadyExistsError(`Workspace already exists at ${root}.`);
  const project = options.name ?? path.basename(root);
  const report = createEmptyReport();
  const mode = options.standalone ? "standalone" : "overlay";
  const envelopeDirectory = options.envelope ?? PREFERRED_ENVELOPE_DIR;
  const layout = options.standalone
    ? defaultStandaloneLayout(envelopeDirectory)
    : defaultOverlayLayout(options.privacy ?? "private", envelopeDirectory);
  const selected = await loadTemplate(options.template ?? "study");
  const expanded = expandTemplate(project, selected, layout);
  const templatePaths = new Set(expanded.files.map((file) => file.path.toLowerCase()));
  const coreFiles = baseCoreTemplates(project, layout).filter(
    (file) => !templatePaths.has(file.path.toLowerCase()),
  );
  const physicalTargets = [
    ...expanded.directories.map((entry) => workspacePhysicalRelativePath(layout, entry.path)),
    ...expanded.files.map((file) => workspacePhysicalRelativePath(layout, file.path)),
    ...coreFiles.map((file) => workspacePhysicalRelativePath(layout, file.path)),
    `${envelopeDirectory}/manifest.json`,
    `${envelopeDirectory}/managed-files.json`,
  ];
  await assertTemplateWriteBoundary(root, physicalTargets);
  await ensureDir(root, root, report);
  const envelope = path.join(root, envelopeDirectory);
  await ensureDir(envelope, root, report);
  for (const logical of ["sources", "analyses", "knowledge", "systems"] as const) {
    await ensureDir(
      path.join(
        root,
        workspacePhysicalRelativePath(layout, workspaceRelativePath(layout, logical)),
      ),
      root,
      report,
    );
  }
  for (const entry of expanded.directories) {
    await ensureDir(
      path.join(root, workspacePhysicalRelativePath(layout, entry.path)),
      root,
      report,
    );
  }
  await ensureDir(path.join(envelope, "events"), root, report);
  await ensureDir(path.join(envelope, "backups"), root, report);
  const nativeProject = await ensureNativeProject(root, layout, project);
  report.created_dirs.push(...nativeProject.createdDirectories);
  report.created_files.push(...nativeProject.createdFiles);
  const installedCore: typeof coreFiles = [];
  for (const file of [...coreFiles, ...expanded.files]) {
    const result = await writeTemplateFile(root, layout, file.path, file.content, report, {
      force: options.force ?? false,
      createNew: options.createNew ?? false,
      executable: file.executable,
    });
    if (result === "written" && file.managed) installedCore.push(file);
  }
  const entries = manifestEntriesForScaffold(layout, expanded, coreFiles);
  const manifest = defaultManifest(entries, envelopeDirectory);
  manifest.layout = layout;
  manifest.layout.entries = entries;
  await saveManifest(root, manifest);
  report.created_files.push(`${envelopeDirectory}/manifest.json`);
  await saveManagedFiles(root, receiptForTemplates(installedCore));
  report.created_files.push(`${envelopeDirectory}/managed-files.json`);
  const agents = await applyAbsorbAgentsBlock({
    root,
    mode: options.agents === false ? "skip" : "install",
  });
  if (agents.changed) {
    (agents.action === "create" ? report.created_files : report.updated_files).push(
      ABSORB_AGENTS_FILE,
    );
  } else if (agents.reason === ABSORB_AGENTS_MALFORMED_REASON) {
    report.notes.push(agents.reason);
  }
  await appendEvent(root, {
    event: "framework.initialized",
    project,
    version: manifest.framework_version,
    mode,
  });
  if (options.git && !(await exists(path.join(root, ".git")))) {
    const result = await execa("git", ["init"], { cwd: root, reject: false });
    report.notes.push(
      result.exitCode === 0
        ? "initialized root git repository"
        : `git init failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return { root, project, template: selected.name, mode, report };
}

export async function checkFramework(options: {
  readonly root: string;
  readonly includeAdvisories?: boolean;
}): Promise<CheckFrameworkResult> {
  const root = path.resolve(options.root);
  let manifest: FrameworkManifest;
  try {
    manifest = requireManifest(await loadManifest(root), root);
  } catch (error) {
    return {
      root,
      ok: false,
      rows: [
        {
          path: "manifest.json",
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  const context = await resolveEnvelopeContext(root);
  const rows: CheckRow[] = [];
  const agentsPlan = await planAbsorbAgentsBlock({ root, mode: "refresh-existing" });
  if (agentsPlan.changed) {
    rows.push({
      path: ABSORB_AGENTS_FILE,
      status: "warning",
      message: "Absorb managed block is stale; run `absorb update --agents`.",
    });
  } else if (agentsPlan.reason === ABSORB_AGENTS_MALFORMED_REASON) {
    rows.push({ path: ABSORB_AGENTS_FILE, status: "warning", message: agentsPlan.reason });
  }
  for (const [label, target] of [
    ["workspace envelope", context.path],
    ["manifest", path.join(context.path, "manifest.json")],
    ["managed receipt", path.join(context.path, "managed-files.json")],
    ["Project identity", path.join(root, projectFileRelativePath(manifest.layout))],
    ["sources", path.join(root, workspaceRelativePath(manifest.layout, "sources"))],
    ["analyses", path.join(root, workspaceRelativePath(manifest.layout, "analyses"))],
    ["knowledge", path.join(root, workspaceRelativePath(manifest.layout, "knowledge"))],
  ] as const) {
    rows.push({
      path: relativeDisplayPath(target, root),
      status: (await exists(target)) ? "ok" : "missing",
      message: label,
    });
  }
  try {
    await validateNativeProjectStructure(root, manifest.layout);
  } catch (error) {
    rows.push({
      path: "project/project.yaml",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    rows.push(
      ...(await collectSourceHealthRows(root, {
        includeAdvisories: options.includeAdvisories ?? false,
      })),
    );
  } catch (error) {
    rows.push({
      path: workspaceRelativePath(manifest.layout, "sources"),
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  let managed = 0;
  try {
    managed = (await loadManagedFiles(root)).files.length;
  } catch (error) {
    rows.push({
      path: `${context.directory}/managed-files.json`,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    root,
    ok: !rows.some((row) => row.status === "missing" || row.status === "error"),
    rows,
    manifest: {
      schema: manifest.__schema,
      frameworkVersion: manifest.framework_version,
      format: `${manifest.framework_version}+s${manifest.__schema}+l${manifest.layout.version}`,
      managedFiles: managed,
    },
  };
}

async function countMarkdown(root: string): Promise<number> {
  if (!(await exists(root))) return 0;
  let count = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) count += await countMarkdown(child);
    else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") count += 1;
  }
  return count;
}

async function countFiles(root: string): Promise<number> {
  if (!(await exists(root))) return 0;
  let count = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) count += await countFiles(child);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

export async function getFrameworkStatus(options: {
  readonly root: string;
}): Promise<FrameworkStatusResult> {
  const root = path.resolve(options.root);
  const manifest = await loadManifest(root);
  if (!manifest) return { root, hasManifest: false, managedFiles: 0 };
  const context = await resolveEnvelopeContext(root);
  const project = await loadNativeProject(root, manifest.layout);
  const zones = await Promise.all(
    manifestZones(manifest.layout.entries, manifest.layout).map(async (zone) => ({
      ...zone,
      files: await countFiles(path.join(root, zone.path)),
    })),
  );
  let sourceSummary: FrameworkStatusResult["sources"];
  try {
    const sources = await getSourceStatus({ root });
    sourceSummary = {
      total: sources.sources.length,
      checkouts: sources.sources.filter((entry) => entry.contentMode === "checkout").length,
      copies: sources.sources.filter((entry) => entry.contentMode === "copy").length,
      majorChanges: sources.sources.filter((entry) => entry.latestChangeClass === "major").length,
      references: sources.sources.filter((entry) => entry.reference !== null).length,
      brokenReferences: sources.broken.length,
    };
  } catch {
    sourceSummary = undefined;
  }
  return {
    root,
    hasManifest: true,
    installedVersion: manifest.framework_version,
    layoutVersion: manifest.layout.version,
    manifestFormat: `${manifest.framework_version}+s${manifest.__schema}+l${manifest.layout.version}`,
    envelope: context.directory,
    ...(project
      ? {
          project: project.name,
          nativeProject: {
            id: project.id,
            name: project.name,
            path: projectRootRelativePath(manifest.layout),
            authority: `${projectRootRelativePath(manifest.layout)}/${project.authority.pointer}`,
          },
        }
      : {}),
    managedFiles: (await loadManagedFiles(root)).files.length,
    ...(manifest.layout.mode === "overlay"
      ? { primarySystem: { path: "." as const, implicit: true as const } }
      : {}),
    ...(sourceSummary ? { sources: sourceSummary } : {}),
    knowledgeEntries: await countMarkdown(
      path.join(root, workspaceRelativePath(manifest.layout, "knowledge")),
    ),
    zones,
  };
}

function dateStamp(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function createAnalysis(
  options: CreateAnalysisOptions,
): Promise<CreateAnalysisResult> {
  const root = path.resolve(options.root);
  const manifest = requireManifest(await loadManifest(root), root);
  const now = options.now ?? new Date();
  const relativePath = workspaceSubpath(
    manifest.layout,
    "analyses",
    "references",
    `${dateStamp(now)}-${slugify(options.title)}.md`,
  );
  const absolutePath = path.join(root, relativePath);
  if (await exists(absolutePath))
    throw new FrameworkAlreadyExistsError(`analysis already exists: ${relativePath}`);
  let sourceBlock = "";
  if (options.forSource) {
    const source = await resolveSourceObservation({
      root,
      alias: options.forSource,
      ...(options.observation ? { observation: options.observation } : {}),
    });
    sourceBlock = `- Source alias: ${source.alias}\n- Source observation: ${source.observation.observation_id}\n${source.observation.vcs ? `- Source commit: ${source.observation.vcs.commit}\n` : ""}`;
  }
  const content = `# ${options.title}\n\n- Date: ${dateStamp(now)}\n- Status: draft\n${sourceBlock}\n## Source\n\n${options.forSource ?? ""}\n\n## Key observations\n\n## Adopt\n\n## Reject\n\n## Next step\n\n## Decision exit\n\n- [ ] adopt\n- [ ] reject\n- [ ] experiment\n`;
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
  const eventFile = await appendEvent(
    root,
    {
      event: "analysis.created",
      path: relativePath,
      title: options.title,
      ...(options.forSource ? { for_source: options.forSource } : {}),
    },
    now,
  );
  return {
    root,
    path: relativePath,
    absolutePath,
    eventFile: relativeDisplayPath(eventFile, root),
  };
}

export async function closeAnalysis(options: CloseAnalysisOptions): Promise<CloseAnalysisResult> {
  const root = path.resolve(options.root);
  requireManifest(await loadManifest(root), root);
  const analysis = resolveContainedPath(root, options.path, "analysis path");
  if (!(await exists(analysis.absolutePath)))
    throw new FrameworkNotFoundError(`analysis not found: ${analysis.relativePath}`);
  let content = await readUtf8File(analysis.absolutePath, "analysis file");
  const sectionPattern = /^## Decision exit\s*$/gm;
  const sectionMatches = [...content.matchAll(sectionPattern)];
  if (sectionMatches.length !== 1 || sectionMatches[0]?.index === undefined) {
    throw new FrameworkError(
      `analysis ${analysis.relativePath} must contain exactly one '## Decision exit' section`,
    );
  }
  const sectionStart = sectionMatches[0].index;
  const bodyStart = sectionStart + sectionMatches[0][0].length;
  const nextSection = /^##\s+/gm;
  nextSection.lastIndex = bodyStart;
  const next = nextSection.exec(content);
  const sectionEnd = next?.index ?? content.length;
  const sectionBody = content.slice(bodyStart, sectionEnd);
  const boxPattern = new RegExp(`^- \\[ \\] ${options.exit}$`, "gm");
  const boxes = [...sectionBody.matchAll(boxPattern)];
  if (boxes.length !== 1 || boxes[0]?.index === undefined) {
    throw new FrameworkError(
      `analysis ${analysis.relativePath}: '## Decision exit' must contain exactly one '- [ ] ${options.exit}' checkbox`,
    );
  }
  const status =
    options.exit === "adopt" ? "applied" : options.exit === "reject" ? "rejected" : "experiment";
  if (!/^- Status: .*$/m.test(content))
    throw new FrameworkError(`analysis ${analysis.relativePath} has no Status header`);
  const absoluteBoxIndex = bodyStart + boxes[0].index;
  const unchecked = `- [ ] ${options.exit}`;
  content = `${content.slice(0, absoluteBoxIndex)}- [x] ${options.exit}${content.slice(
    absoluteBoxIndex + unchecked.length,
  )}`;
  content = content.replace(/^- Status: .*$/m, `- Status: ${status}`);
  if (options.note)
    content += `\n> Closed on ${dateStamp(options.now ?? new Date())}: ${options.note}\n`;
  const alias = /^- Source alias: (.+)$/m.exec(content)?.[1] ?? null;
  const commit = /^- Source commit: (.+)$/m.exec(content)?.[1] ?? null;
  await writeFile(analysis.absolutePath, content, "utf8");
  const eventFile = await appendEvent(
    root,
    {
      event: "analysis.closed",
      path: analysis.relativePath,
      exit: options.exit,
      note: options.note ?? null,
    },
    options.now ?? new Date(),
  );
  const pinSuggestion =
    options.exit !== "experiment" && alias ? evidencePinSuggestion({ alias, commit }) : undefined;
  return {
    root,
    path: analysis.relativePath,
    eventFile: relativeDisplayPath(eventFile, root),
    ...(pinSuggestion ? { pinSuggestion } : {}),
  };
}

const KNOWLEDGE_DIR: Record<KnowledgeType, string> = {
  pattern: "patterns",
  guide: "guides",
  troubleshooting: "troubleshooting",
};
export async function addKnowledge(options: AddKnowledgeOptions): Promise<AddKnowledgeResult> {
  const root = path.resolve(options.root);
  const manifest = requireManifest(await loadManifest(root), root);
  const now = options.now ?? new Date();
  const relativePath = `${workspaceSubpath(manifest.layout, "knowledge", KNOWLEDGE_DIR[options.type])}/${dateStamp(now)}-${slugify(options.title)}.md`;
  const absolutePath = path.join(root, relativePath);
  if (await exists(absolutePath))
    throw new FrameworkAlreadyExistsError(`knowledge entry already exists: ${relativePath}`);
  const origin = options.fromAnalysis ? `\n- from analysis: ${options.fromAnalysis}\n` : "\n";
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    `# ${options.title}\n\n- Type: ${options.type}\n- Date: ${dateStamp(now)}\n- Status: accepted${origin}\n## Summary\n\n## Detail\n`,
    "utf8",
  );
  const eventFile = await appendEvent(
    root,
    {
      event: "knowledge.added",
      path: relativePath,
      type: options.type,
      title: options.title,
      from_analysis: options.fromAnalysis ?? null,
    },
    now,
  );
  return { root, path: relativePath, eventFile: relativeDisplayPath(eventFile, root) };
}
