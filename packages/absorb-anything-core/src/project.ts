import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse, stringify } from "yaml";

import { withWorkspaceMutationCoordination } from "./coordination.js";
import { FrameworkError, FrameworkNotFoundError } from "./errors.js";
import { workspaceWorkRelativePath } from "./layout.js";
import { projectReadableId } from "./readable-id.js";
import { type NativeProject, type WorkspaceLayout, nativeProjectSchema } from "./schemas/index.js";

export const PROJECT_SCHEMA_VERSION = 1 as const;
export const PROJECT_AUTHORITY_MODE = "native" as const;
export const PROJECT_AUTHORITY_POINTER = "README.md" as const;

export interface NativeProjectScaffoldResult {
  readonly project: NativeProject;
  readonly rootPath: string;
  readonly createdDirectories: readonly string[];
  readonly createdFiles: readonly string[];
}

export function projectRootRelativePath(layout: WorkspaceLayout): string {
  return workspaceWorkRelativePath(layout, "project");
}

export function projectFileRelativePath(layout: WorkspaceLayout): string {
  return `${projectRootRelativePath(layout)}/project.yaml`;
}

export function projectReadme(): string {
  return "# Project\n\nThis directory holds the workspace identity. `project.yaml` is the machine-readable authority for its id and name.\n";
}

export function serializeNativeProject(project: NativeProject): string {
  return stringify(nativeProjectSchema.parse(project), { lineWidth: 0 });
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function loadNativeProject(
  root: string,
  layout: WorkspaceLayout,
): Promise<NativeProject | null> {
  const relative = projectFileRelativePath(layout);
  try {
    return nativeProjectSchema.parse(parse(await readFile(path.join(root, relative), "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    if (error instanceof FrameworkError) throw error;
    throw new FrameworkError(`native Project envelope failed validation: ${relative}`, {
      code: "IO_ERROR",
      cause: error,
    });
  }
}

export async function ensureNativeProject(
  rootInput: string,
  layout: WorkspaceLayout,
  name: string,
): Promise<NativeProjectScaffoldResult> {
  const root = path.resolve(rootInput);
  return withWorkspaceMutationCoordination(root, async () => {
    const rootPath = projectRootRelativePath(layout);
    const projectDir = path.join(root, rootPath);
    const createdDirectories: string[] = [];
    const createdFiles: string[] = [];
    if (!(await exists(projectDir))) {
      await mkdir(projectDir, { recursive: true });
      createdDirectories.push(rootPath);
    }
    let project = await loadNativeProject(root, layout);
    if (!project) {
      project = nativeProjectSchema.parse({
        __schema: PROJECT_SCHEMA_VERSION,
        id: projectReadableId(name),
        name,
        authority: { mode: PROJECT_AUTHORITY_MODE, pointer: PROJECT_AUTHORITY_POINTER },
      });
      const relative = projectFileRelativePath(layout);
      await writeFile(path.join(root, relative), serializeNativeProject(project), {
        encoding: "utf8",
        flag: "wx",
      });
      createdFiles.push(relative);
    }
    const readme = `${rootPath}/README.md`;
    if (!(await exists(path.join(root, readme)))) {
      await writeFile(path.join(root, readme), projectReadme(), { encoding: "utf8", flag: "wx" });
      createdFiles.push(readme);
    }
    return { project, rootPath, createdDirectories, createdFiles };
  });
}

export async function validateNativeProjectStructure(
  root: string,
  layout: WorkspaceLayout,
): Promise<void> {
  const projectDir = path.join(root, projectRootRelativePath(layout));
  for (const [target, label, kind] of [
    [projectDir, "native Project", "directory"],
    [path.join(projectDir, "project.yaml"), "native Project envelope", "file"],
    [path.join(projectDir, PROJECT_AUTHORITY_POINTER), "native Project authority pointer", "file"],
  ] as const) {
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(target);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new FrameworkNotFoundError(`${label} not found: ${target}`);
      }
      throw error;
    }
    if (info.isSymbolicLink() || (kind === "directory" ? !info.isDirectory() : !info.isFile())) {
      throw new FrameworkError(`${label} has an invalid filesystem boundary: ${target}`);
    }
  }
  await loadNativeProject(root, layout);
}

export async function preflightNativeProjectBoundary(
  root: string,
  layout: WorkspaceLayout,
): Promise<void> {
  const projectDir = path.join(root, projectRootRelativePath(layout));
  if (!(await exists(projectDir))) return;
  const info = await lstat(projectDir);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new FrameworkError(`native Project must be a real directory: ${projectDir}`);
  }
}

export async function preflightWorkspaceManifestBoundary(root: string): Promise<void> {
  for (const name of [".absorb", ".assay"] as const) {
    const target = path.join(root, name);
    if (!(await exists(target))) continue;
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new FrameworkError(`workspace envelope must be a real directory: ${target}`);
    }
  }
}
