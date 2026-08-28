import path from "node:path";

import {
  BACKUPS_DIR,
  EVENTS_DIR,
  MANAGED_DIR,
  MANIFEST_FILE,
  SYSTEMS_REGISTRY_FILE,
} from "./constants.js";
import { type EnvelopeDirectory, projectLogicalPath } from "./envelope.js";
import type {
  FrameworkManifest,
  WorkspaceLayout,
  WorkspaceLayoutMode,
  WorkspacePrivacy,
} from "./schemas/index.js";

export type WorkspaceArea =
  | "manifest"
  | "events"
  | "backups"
  | "systemsRegistry"
  | "sources"
  | "analyses"
  | "knowledge"
  | "systems";

const envelopeByLayout = new WeakMap<object, EnvelopeDirectory>();

export function bindWorkspaceEnvelope<T extends WorkspaceLayout>(
  layout: T,
  directory: EnvelopeDirectory,
): T {
  envelopeByLayout.set(layout, directory);
  return layout;
}

export function workspaceEnvelope(layout: WorkspaceLayout): EnvelopeDirectory {
  return envelopeByLayout.get(layout) ?? ".absorb";
}

export function resolveWorkspaceLayout(manifest: FrameworkManifest | null): WorkspaceLayout | null {
  return manifest?.layout ?? null;
}

export function defaultStandaloneLayout(directory: EnvelopeDirectory = ".absorb"): WorkspaceLayout {
  return bindWorkspaceEnvelope(
    {
      version: 8,
      mode: "standalone",
      state_root: ".assay",
      work_root: ".",
      privacy: "tracked",
      paths: standalonePaths(),
      entries: [],
    },
    directory,
  );
}

export function defaultOverlayLayout(
  privacy: WorkspacePrivacy = "private",
  directory: EnvelopeDirectory = ".absorb",
): WorkspaceLayout {
  return bindWorkspaceEnvelope(
    {
      version: 8,
      mode: "overlay",
      state_root: ".assay",
      work_root: ".assay",
      privacy,
      paths: overlayPaths(),
      entries: [],
    },
    directory,
  );
}

function logicalArea(layout: WorkspaceLayout, area: WorkspaceArea): string {
  switch (area) {
    case "manifest":
      return layout.paths.manifest;
    case "events":
      return layout.paths.events;
    case "backups":
      return layout.paths.backups;
    case "systemsRegistry":
      return layout.paths.systems_registry;
    case "sources":
      return layout.paths.sources;
    case "analyses":
      return layout.paths.analyses;
    case "knowledge":
      return layout.paths.knowledge;
    case "systems":
      return layout.paths.systems;
  }
}

export function workspacePath(root: string, layout: WorkspaceLayout, area: WorkspaceArea): string {
  return path.join(root, workspaceRelativePath(layout, area));
}

export function workspaceRelativePath(layout: WorkspaceLayout, area: WorkspaceArea): string {
  return projectLogicalPath(logicalArea(layout, area), workspaceEnvelope(layout));
}

export function workspaceSubpath(
  layout: WorkspaceLayout,
  area: WorkspaceArea,
  ...segments: readonly string[]
): string {
  return [
    workspaceRelativePath(layout, area),
    ...segments.map((segment) => toRelativePosix(segment)),
  ]
    .filter(Boolean)
    .join("/");
}

export function workspaceWorkRelativePath(layout: WorkspaceLayout, relativePath: string): string {
  const normalized = toRelativePosix(relativePath);
  if (layout.work_root === ".") return normalized;
  return [workspaceEnvelope(layout), normalized].filter(Boolean).join("/");
}

const WORK_AREA_BY_SEGMENT: Readonly<Record<string, WorkspaceArea>> = {
  sources: "sources",
  analyses: "analyses",
  knowledge: "knowledge",
  systems: "systems",
};

export function workspaceTemplateRelativePath(
  layout: WorkspaceLayout,
  templatePath: string,
): string {
  const normalized = toRelativePosix(templatePath);
  if (normalized === MANAGED_DIR || normalized.startsWith(`${MANAGED_DIR}/`)) return normalized;
  const [first, ...rest] = normalized.split("/");
  const area = first === undefined ? undefined : WORK_AREA_BY_SEGMENT[first];
  if (area) return [logicalArea(layout, area), ...rest].join("/");
  return layout.work_root === "."
    ? normalized
    : [layout.work_root, normalized].filter(Boolean).join("/");
}

/** Project a persisted logical path onto the selected physical envelope. */
export function workspacePhysicalRelativePath(
  layout: WorkspaceLayout,
  logicalPath: string,
): string {
  return projectLogicalPath(toRelativePosix(logicalPath), workspaceEnvelope(layout));
}

function toRelativePosix(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

export function standalonePaths() {
  return {
    manifest: MANIFEST_FILE,
    events: EVENTS_DIR,
    backups: BACKUPS_DIR,
    systems_registry: SYSTEMS_REGISTRY_FILE,
    sources: "sources",
    analyses: "analyses",
    knowledge: "knowledge",
    systems: "systems",
  };
}

export function overlayPaths() {
  return {
    ...standalonePaths(),
    sources: `${MANAGED_DIR}/sources`,
    analyses: `${MANAGED_DIR}/analyses`,
    knowledge: `${MANAGED_DIR}/knowledge`,
    systems: `${MANAGED_DIR}/systems`,
  };
}

export type { WorkspaceLayoutMode, WorkspacePrivacy };
