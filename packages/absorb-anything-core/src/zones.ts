import { workspacePhysicalRelativePath, workspaceWorkRelativePath } from "./layout.js";
import type { ManifestEntry, WorkspaceLayout } from "./schemas/index.js";

export interface WorkspaceZone {
  readonly path: string;
  readonly purpose: string;
}

/** One manifest-derived registry used by status and the managed AGENTS block. */
export function manifestZones(
  entries: readonly ManifestEntry[],
  layout?: WorkspaceLayout,
): WorkspaceZone[] {
  const resolved = (relative: string) =>
    layout ? workspaceWorkRelativePath(layout, relative) : relative;
  const native: WorkspaceZone[] = [
    { path: resolved("project"), purpose: "Native Project identity" },
    { path: resolved("sources"), purpose: "External material and observation history" },
    { path: resolved("analyses"), purpose: "Working analysis records" },
    { path: resolved("knowledge"), purpose: "Accepted reusable knowledge" },
  ];
  const declared = entries
    .filter((entry) => entry.kind === "directory")
    .map(({ path, purpose }) => ({
      path: layout ? workspacePhysicalRelativePath(layout, path) : path,
      purpose,
    }));
  const byPath = new Map([...declared, ...native].map((entry) => [entry.path, entry]));
  return [...byPath.values()].filter((entry) => {
    const segments = entry.path.split("/").filter(Boolean);
    return segments.length > 0 && !(segments.length > 1 && segments.at(-1) === "templates");
  });
}

export function zoneTable(zones: readonly WorkspaceZone[]): string[] {
  if (zones.length === 0) return [];
  return [
    "| Directory | What goes here |",
    "| --- | --- |",
    ...zones.map((zone) => `| \`${zone.path}/\` | ${zone.purpose.replaceAll("|", "\\|")} |`),
  ];
}
