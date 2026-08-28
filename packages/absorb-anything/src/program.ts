import path from "node:path";
import { Command, Option } from "@commander-js/extra-typings";
import {
  type AnalysisExit,
  type KnowledgeType,
  PRODUCT_VERSION,
  SEMANTIC_TOPICS,
  SOURCE_CHANGE_CLASSES,
  type SourceChangeClass,
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
  migrateEnvelope,
  primeWorkspace,
  requireObjectSemantics,
  resolveSourceHome,
  semanticDigestSentence,
  semanticHints,
  switchSource,
  syncSource,
  unlinkSource,
} from "absorb-anything-core";

import { mapCliError } from "./errors.js";

export interface CliOutput {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly setExitCode: (code: number) => void;
}
export interface CreateProgramOptions {
  readonly output?: Partial<CliOutput>;
}

function defaultOutput(): CliOutput {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };
}

function createOutput(options?: CreateProgramOptions): CliOutput {
  const fallback = defaultOutput();
  return {
    stdout: options?.output?.stdout ?? fallback.stdout,
    stderr: options?.output?.stderr ?? fallback.stderr,
    setExitCode: options?.output?.setExitCode ?? fallback.setExitCode,
  };
}

function emit(output: Pick<CliOutput, "stdout">, value: unknown, json = false): void {
  output.stdout(`${json || typeof value !== "string" ? JSON.stringify(value, null, 2) : value}\n`);
}

function withHint(message: string, key: Parameters<typeof semanticHints>[0]): string {
  return `${message}\nHint: ${semanticHints(key).join(" ")}`;
}

function withJsonHints<T extends object>(
  result: T,
  key: Parameters<typeof semanticHints>[0],
): T & { readonly hints: readonly string[] } {
  return { ...result, hints: semanticHints(key) };
}

async function rootFor(input: string): Promise<string> {
  return discoverFrameworkRoot(input);
}

function sourceSummary(result: Awaited<ReturnType<typeof getSourceStatus>>): string {
  if (result.sources.length === 0 && result.broken.length === 0) return "No Sources.";
  return [
    ...result.sources.map(
      (source) =>
        `${source.alias}: ${source.contentMode}${source.latestObservation ? ` @ ${source.latestObservation}` : ""}${source.reference ? `  ref -> ${source.reference.display}` : ""}`,
    ),
    ...result.broken.map(
      (reference) => `${reference.alias}: broken reference (${reference.reason})`,
    ),
  ].join("\n");
}

function referenceLines(
  reference:
    | Awaited<ReturnType<typeof getSourceLog>>["reference"]
    | Awaited<ReturnType<typeof diffSource>>["reference"],
): string[] {
  return reference ? [`Relation: ref -> ${reference.display}`, `Home: ${reference.homeRoot}`] : [];
}

function briefLine(home: string, brief: string | null): string {
  return brief === null ? "Brief: none in the home workspace" : `Brief: ${path.join(home, brief)}`;
}

function formatSourceLog(result: Awaited<ReturnType<typeof getSourceLog>>): string {
  return [
    `Source log: ${result.alias}`,
    ...referenceLines(result.reference),
    ...(result.entries.length === 0
      ? ["(none)"]
      : result.entries.flatMap(({ observation }) => [
          `${observation.observed_on} ${observation.kind} ${observation.change_class} ${observation.observation_id}${observation.capture ? " [capture]" : ""}`,
          `  ${observation.note}`,
        ])),
  ].join("\n");
}

function formatSourceDiff(result: Awaited<ReturnType<typeof diffSource>>): string {
  return [
    `Source diff: ${result.alias}`,
    ...referenceLines(result.reference),
    `From: ${result.from ?? "none"}`,
    `To: ${result.to ?? "none"}`,
    `Added: ${result.added.length}`,
    ...result.added.map((file) => `  + ${file}`),
    `Removed: ${result.removed.length}`,
    ...result.removed.map((file) => `  - ${file}`),
    `Changed: ${result.changed.length}`,
    ...result.changed.map((file) => `  * ${file}`),
  ].join("\n");
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const output = createOutput(options);
  const program = new Command()
    .name("absorb")
    .description("Absorb external material into source evidence, analysis, and reusable knowledge.")
    .version(PRODUCT_VERSION)
    .configureOutput({ writeOut: output.stdout, writeErr: output.stderr });

  program
    .command("init")
    .description("Initialize an overlay workspace; use --standalone for a dedicated workbench")
    .argument("[target-dir]", "target workspace directory", process.cwd())
    .option("--name <project-name>", "project name")
    .option("--standalone", "place work folders at the workspace root")
    .option("--git", "initialize Git at the workspace root")
    .option("--force", "overwrite existing scaffold files")
    .option("--create-new", "write .new copies when scaffold files already exist")
    .option("--no-agents", "skip the managed AGENTS.md block")
    .addOption(
      new Option(
        "--template <template>",
        "study, solve, explore, or an explicit YAML path",
      ).default("study"),
    )
    .action(async (target, commandOptions) => {
      const result = await initFramework({
        target,
        ...(commandOptions.name ? { name: commandOptions.name } : {}),
        standalone: commandOptions.standalone ?? false,
        git: commandOptions.git ?? false,
        force: commandOptions.force ?? false,
        createNew: commandOptions.createNew ?? false,
        template: commandOptions.template,
        agents: commandOptions.agents,
      });
      emit(
        output,
        `Initialized ${result.mode} workspace: ${result.root}\nProject: ${result.project}\nTemplate: ${result.template}`,
      );
    });

  program
    .command("check")
    .description("Check common envelope and absorb-owned records")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--advisories", "include non-blocking Source advisories")
    .option("--json", "emit JSON")
    .action(async (commandOptions) => {
      const result = await checkFramework({
        root: await rootFor(commandOptions.root),
        includeAdvisories: commandOptions.advisories ?? false,
      });
      emit(
        output,
        commandOptions.json
          ? result
          : result.rows
              .map(
                (row) =>
                  `${row.status.toUpperCase()} ${row.path}${row.message ? ` — ${row.message}` : ""}`,
              )
              .join("\n"),
        commandOptions.json,
      );
      if (!result.ok) output.setExitCode(1);
    });

  program
    .command("update")
    .description("Update managed common files without replacing user edits")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--dry-run", "plan without writing")
    .addOption(new Option("--force", "overwrite modified managed files").conflicts("createNew"))
    .addOption(new Option("--create-new", "write .new copies for conflicts").conflicts("force"))
    .option("--agents", "install or refresh the managed AGENTS.md block")
    .option("--json", "emit JSON")
    .action(async (commandOptions) => {
      const action = commandOptions.force
        ? "force"
        : commandOptions.createNew
          ? "create-new"
          : "skip";
      const result = await applyUpdate({
        root: await rootFor(commandOptions.root),
        dryRun: commandOptions.dryRun ?? false,
        action,
        agents: commandOptions.agents ?? false,
      });
      emit(
        output,
        commandOptions.json
          ? result
          : result.changes
              .map((change) => `${change.kind}: ${change.path} -> ${change.action}`)
              .join("\n"),
        commandOptions.json,
      );
    });

  program
    .command("migrate-envelope")
    .description(
      "Rename a legacy envelope directory to .absorb without copying or deleting content",
    )
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--json", "emit JSON")
    .action(async (commandOptions) => {
      const result = await migrateEnvelope(commandOptions.root);
      emit(
        output,
        commandOptions.json
          ? result
          : result.changed
            ? `Migrated envelope: ${result.from} -> ${result.to}`
            : `Envelope already current: ${result.to}`,
        commandOptions.json,
      );
    });

  program
    .command("prime")
    .description("Orient a session with object semantics and workspace state")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--json", "emit JSON")
    .action(async (commandOptions) => {
      const result = await primeWorkspace({ root: await rootFor(commandOptions.root) });
      const human = [
        "Absorb prime",
        `Root: ${result.root}`,
        ...result.semantics.map((entry) => `- ${semanticDigestSentence(entry)}`),
        result.workspace
          ? `Workspace: ${result.workspace.envelope} (${result.workspace.installedVersion})`
          : "Workspace: not initialized",
        `Details: ${result.detailsCommand}`,
      ].join("\n");
      emit(output, commandOptions.json ? result : human, commandOptions.json);
    });

  program
    .command("explain")
    .description(`Explain an object (${SEMANTIC_TOPICS.join(", ")})`)
    .argument("<topic>", "object topic")
    .option("--json", "emit JSON")
    .action(async (topic, commandOptions) => {
      const entry = requireObjectSemantics(topic);
      const human = [
        `${entry.label} — ${entry.purpose}`,
        `Most-broken rule: ${entry.antiRule}`,
        "Why it exists:",
        ...entry.whyItExists.map((line) => `- ${line}`),
        "When not to use it:",
        ...entry.whenNotToUse.map((line) => `- ${line}`),
        "Common misuses:",
        ...entry.commonMisuses.map((line) => `- ${line}`),
        "Commands:",
        ...entry.commands.map((line) => `- ${line}`),
      ].join("\n");
      emit(output, commandOptions.json ? entry : human, commandOptions.json);
    });

  program
    .command("add")
    .description("Add an external Source")
    .argument("<repo-or-dir>", "local directory or Git URL")
    .argument("[alias]", "source alias")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--branch <branch>", "Git branch")
    .option("--json", "emit JSON")
    .action(async (source, alias, commandOptions) => {
      const result = await addSource({
        root: await rootFor(commandOptions.root),
        source,
        ...(alias ? { alias } : {}),
        ...(commandOptions.branch ? { branch: commandOptions.branch } : {}),
      });
      emit(
        output,
        commandOptions.json
          ? withJsonHints(result, "source add")
          : withHint(
              [
                ...result.notices,
                `Added source: ${result.path}`,
                `Observation: ${result.observationFile}`,
                `${result.contentMode === "checkout" ? "Checkout" : "Content"}: ${result.contentPath}`,
                `Materials: ${result.materialsPath}`,
              ].join("\n"),
              "source add",
            ),
        commandOptions.json,
      );
    });

  program
    .command("link")
    .description("Reference a Source owned by another workspace")
    .argument("<target-workspace-or-source>", "workspace path or registry-known source alias")
    .argument("[target-source]", "source alias in the target workspace")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--alias <local-alias>", "local alias")
    .option("--json", "emit JSON")
    .action(async (workspaceOrSource, targetSource, commandOptions) => {
      const target = targetSource
        ? { workspace: workspaceOrSource, source: targetSource }
        : { source: workspaceOrSource };
      const result = await linkSource({
        root: await rootFor(commandOptions.root),
        ...target,
        ...(commandOptions.alias ? { alias: commandOptions.alias } : {}),
      });
      emit(
        output,
        commandOptions.json
          ? withJsonHints(result, "source link")
          : withHint(
              [
                result.created
                  ? `Linked source: ${result.path}`
                  : `Source already linked: ${result.path}`,
                `Reference: ${result.alias} ref -> ${result.home.workspaceRecorded}#${result.home.alias}`,
                `Home workspace: ${result.home.workspace}`,
                `Home path: ${result.home.path}`,
                briefLine(result.home.workspace, result.brief),
                ...result.notices.map((notice) => `Notice: ${notice}`),
              ].join("\n"),
              "source link",
            ),
        commandOptions.json,
      );
    });

  program
    .command("home")
    .description("Show the workspace that owns a local source alias")
    .argument("<alias>")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--json", "emit JSON")
    .action(async (alias, commandOptions) => {
      const result = await resolveSourceHome({ root: await rootFor(commandOptions.root), alias });
      emit(
        output,
        commandOptions.json
          ? result
          : [
              `Source home: ${result.alias}`,
              `Relation: ${result.relation}`,
              `Home workspace: ${result.homeWorkspace}`,
              `Home alias: ${result.homeAlias}`,
              `Home path: ${result.homePath}`,
              ...(result.display ? [`Recorded: ${result.display}`] : []),
              briefLine(result.homeWorkspace, result.brief),
            ].join("\n"),
        commandOptions.json,
      );
    });

  program
    .command("unlink")
    .description("Remove a local Source reference")
    .argument("<alias>")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--json", "emit JSON")
    .action(async (alias, commandOptions) => {
      const result = await unlinkSource({ root: await rootFor(commandOptions.root), alias });
      emit(
        output,
        commandOptions.json
          ? withJsonHints(result, "source unlink")
          : withHint(
              [
                `Unlinked source: ${result.path}`,
                `Forgot reference: ${result.display}`,
                result.homeReachable
                  ? `Home workspace: ${result.homeWorkspace} (untouched)`
                  : `Home workspace: ${result.homeWorkspace} (not reachable; nothing was touched there)`,
              ].join("\n"),
              "source unlink",
            ),
        commandOptions.json,
      );
    });

  program
    .command("capture")
    .description("Preserve a Source's current bytes")
    .argument("<alias>")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--note <text>", "capture note")
    .option("--json", "emit JSON")
    .action(async (alias, commandOptions) => {
      const notices: string[] = [];
      const result = await captureSource({
        root: await rootFor(commandOptions.root),
        alias,
        ...(commandOptions.note ? { note: commandOptions.note } : {}),
        onNotice: (notice) => notices.push(notice),
      });
      emit(
        output,
        commandOptions.json
          ? withJsonHints(result, "source capture")
          : withHint(
              [
                ...notices,
                ...(result.reference ? [`Home workspace: ${result.reference.homeRoot}`] : []),
                `Captured source: ${result.path}`,
                `Capture: ${result.capturePath}`,
                `Content: ${result.capture.file_count} files, ${result.capture.byte_count} bytes`,
                `Integrity: ${result.capture.algorithm}:${result.capture.value}`,
                `Observation: ${result.observationFile}`,
              ].join("\n"),
              "source capture",
            ),
        commandOptions.json,
      );
    });

  program
    .command("import")
    .description("Replace a copied Source's content")
    .argument("<alias>")
    .argument("<dir-or-archive>")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--note <text>", "import note")
    .option("--json", "emit JSON")
    .action(async (alias, from, commandOptions) => {
      const notices: string[] = [];
      const result = await importSourceContent({
        root: await rootFor(commandOptions.root),
        alias,
        from,
        ...(commandOptions.note ? { note: commandOptions.note } : {}),
        onNotice: (notice) => notices.push(notice),
      });
      emit(
        output,
        commandOptions.json
          ? withJsonHints(result, "source import")
          : withHint(
              [
                ...notices,
                ...(result.reference ? [`Home workspace: ${result.reference.homeRoot}`] : []),
                `Imported content: ${result.contentPath}`,
                `Change class: ${result.changeClass}`,
                ...(result.preservedCapture ? [`Preserved: ${result.preservedCapture.path}`] : []),
                `Observation: ${result.observationFile}`,
              ].join("\n"),
              "source import",
            ),
        commandOptions.json,
      );
    });

  program
    .command("sync")
    .description("Refresh and observe a checkout-backed Source")
    .argument("[alias]")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--branch <branch>", "Git branch")
    .option("--ref <ref>", "Git ref")
    .addOption(
      new Option("--class <change-class>", "advisory change class").choices([
        ...SOURCE_CHANGE_CLASSES,
      ]),
    )
    .option("--json", "emit JSON")
    .action(async (alias, commandOptions) => {
      const notices: string[] = [];
      const result = await syncSource({
        root: await rootFor(commandOptions.root),
        ...(alias ? { alias } : {}),
        ...(commandOptions.branch ? { branch: commandOptions.branch } : {}),
        ...(commandOptions.ref ? { ref: commandOptions.ref } : {}),
        ...(commandOptions.class ? { changeClass: commandOptions.class as SourceChangeClass } : {}),
        onNotice: (notice) => notices.push(notice),
      });
      emit(
        output,
        commandOptions.json
          ? withJsonHints(result, "source sync")
          : withHint(
              [
                ...notices,
                `Source sync: ${result.alias}`,
                ...referenceLines(result.reference),
                `Path: ${result.path}`,
                `Change: ${result.changeClass}`,
                `Observation: ${result.observationFile ?? "unchanged"}`,
                ...result.advisories.map((advisory) => `Advisory: ${advisory}`),
              ].join("\n"),
              "source sync",
            ),
        commandOptions.json,
      );
    });

  program
    .command("switch")
    .description("Switch a checkout-backed Source to a branch or ref")
    .argument("<alias>")
    .argument("<branch-or-ref>")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--sync", "record an observation after switching")
    .option("--json", "emit JSON")
    .action(async (alias, target, commandOptions) => {
      const notices: string[] = [];
      const result = await switchSource({
        root: await rootFor(commandOptions.root),
        alias,
        target,
        sync: commandOptions.sync ?? false,
        onNotice: (notice) => notices.push(notice),
      });
      emit(
        output,
        commandOptions.json
          ? withJsonHints(result, "source switch")
          : withHint(
              [
                ...notices,
                ...(result.reference ? [`Home workspace: ${result.reference.homeRoot}`] : []),
                `Switched source: ${result.path}`,
                `Ref: ${result.vcs.ref}`,
                `Commit: ${result.vcs.commit}`,
                ...(result.sync
                  ? [
                      `Source sync: ${result.sync.alias}`,
                      `Change: ${result.sync.changeClass}`,
                      `Observation: ${result.sync.observationFile ?? "unchanged"}`,
                    ]
                  : []),
              ].join("\n"),
              "source switch",
            ),
        commandOptions.json,
      );
    });

  program
    .command("status")
    .description("Show workspace and Source status")
    .argument("[alias]", "optional Source alias")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--json", "emit JSON")
    .action(async (alias, commandOptions) => {
      const root = await rootFor(commandOptions.root);
      if (alias) {
        const all = await getSourceStatus({ root });
        const result = {
          ...all,
          sources: all.sources.filter((entry) => entry.alias === alias),
          broken: all.broken.filter((entry) => entry.alias === alias),
        };
        if (result.sources.length === 0 && result.broken.length === 0) {
          await getSourceStatus({ root, alias });
        }
        emit(output, commandOptions.json ? result : sourceSummary(result), commandOptions.json);
      } else {
        const result = await getFrameworkStatus({ root });
        emit(
          output,
          commandOptions.json
            ? result
            : `Workspace: ${result.envelope ?? "not initialized"}\nProject: ${result.project ?? "unknown"}\nPrimary System: ${result.primarySystem ? ". (implicit)" : "none"}\nSources: ${result.sources?.total ?? 0}\nBroken references: ${result.sources?.brokenReferences ?? 0}\nKnowledge: ${result.knowledgeEntries ?? 0}`,
          commandOptions.json,
        );
      }
    });

  program
    .command("log")
    .description("Show a Source observation log")
    .argument("<alias>")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--json", "emit JSON")
    .action(async (alias, commandOptions) => {
      const result = await getSourceLog({ root: await rootFor(commandOptions.root), alias });
      emit(output, commandOptions.json ? result : formatSourceLog(result), commandOptions.json);
    });

  program
    .command("diff")
    .description("Show file-level Source differences")
    .argument("<alias>")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--since <observation>", "observation id or path")
    .option("--json", "emit JSON")
    .action(async (alias, commandOptions) => {
      const result = await diffSource({
        root: await rootFor(commandOptions.root),
        alias,
        ...(commandOptions.since ? { since: commandOptions.since } : {}),
      });
      emit(output, commandOptions.json ? result : formatSourceDiff(result), commandOptions.json);
    });

  const analysis = program.command("analysis").description("Analysis operations");
  analysis
    .command("new")
    .argument("<title>")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--for-source <alias>", "Source alias")
    .option("--observation <id-or-path>", "Source observation")
    .option("--json", "emit JSON")
    .action(async (title, commandOptions) => {
      const result = await createAnalysis({
        root: await rootFor(commandOptions.root),
        title,
        ...(commandOptions.forSource ? { forSource: commandOptions.forSource } : {}),
        ...(commandOptions.observation ? { observation: commandOptions.observation } : {}),
      });
      emit(
        output,
        commandOptions.json
          ? withJsonHints(result, "analysis new")
          : withHint(`Created analysis: ${result.path}`, "analysis new"),
        commandOptions.json,
      );
    });
  analysis
    .command("close")
    .argument("<path>")
    .addOption(
      new Option("--exit <exit>").choices(["adopt", "reject", "experiment"]).makeOptionMandatory(),
    )
    .option("--note <text>")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--json", "emit JSON")
    .action(async (analysisPath, commandOptions) => {
      const result = await closeAnalysis({
        root: await rootFor(commandOptions.root),
        path: analysisPath,
        exit: commandOptions.exit as AnalysisExit,
        ...(commandOptions.note ? { note: commandOptions.note } : {}),
      });
      emit(
        output,
        commandOptions.json
          ? withJsonHints(result, "analysis close")
          : withHint(
              `Closed analysis: ${result.path}\nExit: ${commandOptions.exit}${result.pinSuggestion ? `\n${result.pinSuggestion}` : ""}`,
              "analysis close",
            ),
        commandOptions.json,
      );
    });

  const knowledge = program.command("knowledge").description("Knowledge operations");
  knowledge
    .command("add")
    .argument("<type>", "pattern, guide, troubleshooting")
    .argument("<title>")
    .option("--from-analysis <path>")
    .option("--root <target-dir>", "workspace root", process.cwd())
    .option("--json", "emit JSON")
    .action(async (type, title, commandOptions) => {
      if (!["pattern", "guide", "troubleshooting"].includes(type))
        throw new Error(`Invalid knowledge type '${type}'.`);
      const result = await addKnowledge({
        root: await rootFor(commandOptions.root),
        type: type as KnowledgeType,
        title,
        ...(commandOptions.fromAnalysis ? { fromAnalysis: commandOptions.fromAnalysis } : {}),
      });
      emit(
        output,
        commandOptions.json
          ? withJsonHints(result, "knowledge add")
          : withHint(`Added knowledge: ${result.path}`, "knowledge add"),
        commandOptions.json,
      );
    });

  return program;
}

export async function runCli(
  argv: readonly string[],
  options: CreateProgramOptions = {},
): Promise<number> {
  let exitCode = 0;
  const runtimeOutput = createOutput(options);
  const output = {
    ...runtimeOutput,
    setExitCode: (code: number) => {
      exitCode = code;
      runtimeOutput.setExitCode(code);
    },
  };
  const program = createProgram({ ...options, output }).exitOverride();
  try {
    await program.parseAsync([...argv], { from: "node" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "commander.helpDisplayed")
      return 0;
    if (error instanceof Error && "exitCode" in error && typeof error.exitCode === "number")
      return error.exitCode;
    const failure = mapCliError(error);
    runtimeOutput.stderr(`${failure.message}\n`);
    return failure.exitCode;
  }
  return exitCode;
}
