import { z } from "zod";

import { CURRENT_VERSION } from "../constants.js";
import { isReadableId } from "../readable-id.js";

export const managedFileRecordSchema = z
  .object({
    path: z.string().min(1),
    asset: z.string().min(1).optional(),
    generator: z.string().min(1).optional(),
    baseline_hash: z.string().regex(/^[a-f0-9]{64}$/),
    protected: z.boolean(),
    executable: z.boolean(),
  })
  .strict()
  .refine(
    (value) => Number(value.asset !== undefined) + Number(value.generator !== undefined) === 1,
    { message: "managed file record must declare exactly one of asset or generator" },
  );

export const managedFilesReceiptSchema = z
  .object({ __schema: z.literal(1), files: z.array(managedFileRecordSchema).max(256) })
  .strict();

export const nativeProjectSchema = z
  .object({
    __schema: z.literal(1),
    id: z.string().refine((value) => isReadableId("project", value), "invalid native Project id"),
    name: z.string().trim().min(1),
    authority: z.object({ mode: z.literal("native"), pointer: z.literal("README.md") }).strict(),
  })
  .strict();

export const workspaceLayoutModeSchema = z.enum(["standalone", "overlay"]);
export const workspacePrivacySchema = z.enum(["tracked", "private", "private-git"]);
export const workspaceLayoutPathsSchema = z
  .object({
    manifest: z.string().min(1),
    events: z.string().min(1),
    backups: z.string().min(1),
    systems_registry: z.string().min(1),
    sources: z.string().min(1),
    analyses: z.string().min(1),
    knowledge: z.string().min(1),
    systems: z.string().min(1),
  })
  .strict();
export const manifestEntrySchema = z
  .object({ path: z.string().min(1), kind: z.enum(["directory", "file"]), purpose: z.string() })
  .strict();

const standalonePaths = {
  manifest: ".assay/manifest.json",
  events: ".assay/events",
  backups: ".assay/backups",
  systems_registry: ".assay/systems-registry.json",
  sources: "sources",
  analyses: "analyses",
  knowledge: "knowledge",
  systems: "systems",
} as const;
const overlayPaths = {
  ...standalonePaths,
  sources: ".assay/sources",
  analyses: ".assay/analyses",
  knowledge: ".assay/knowledge",
  systems: ".assay/systems",
} as const;

function pathLikeAbsolute(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

export const workspaceLayoutSchema = z
  .object({
    version: z.literal(8),
    mode: workspaceLayoutModeSchema,
    state_root: z.literal(".assay"),
    work_root: z.enum([".", ".assay"]),
    privacy: workspacePrivacySchema,
    paths: workspaceLayoutPathsSchema,
    entries: z.array(manifestEntrySchema).max(1024),
  })
  .strict()
  .superRefine((layout, context) => {
    const expected = layout.mode === "standalone" ? standalonePaths : overlayPaths;
    const expectedWorkRoot = layout.mode === "standalone" ? "." : ".assay";
    if (layout.work_root !== expectedWorkRoot) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["work_root"],
        message: `layout v8 ${layout.mode} work_root must be '${expectedWorkRoot}'`,
      });
    }
    if (layout.mode === "standalone" && layout.privacy !== "tracked") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["privacy"],
        message: "layout v8 standalone privacy must be 'tracked'",
      });
    }
    for (const [key, value] of Object.entries(expected)) {
      if (layout.paths[key as keyof typeof expected] !== value) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paths", key],
          message: `layout v8 ${layout.mode} path '${key}' must be '${value}'`,
        });
      }
    }
    const seen = new Set<string>();
    for (const [index, entry] of layout.entries.entries()) {
      const normalized = entry.path.replaceAll("\\", "/");
      if (
        pathLikeAbsolute(normalized) ||
        normalized === "." ||
        normalized === ".." ||
        normalized.split("/").some((part) => part === "" || part === "." || part === "..")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "path"],
          message: "layout entry path must be a normalized workspace-relative path",
        });
      }
      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "path"],
          message: "layout entry paths must be unique",
        });
      }
      seen.add(key);
    }
  });

export const frameworkManifestSchema = z
  .object({
    __schema: z.literal(4),
    framework_version: z.literal(CURRENT_VERSION),
    layout: workspaceLayoutSchema,
  })
  .strict();

export const operationReportSchema = z
  .object({
    created_dirs: z.array(z.string()),
    existing_dirs: z.array(z.string()),
    created_files: z.array(z.string()),
    updated_files: z.array(z.string()),
    skipped_files: z.array(z.string()),
    conflicted_files: z.array(z.string()),
    new_copies: z.array(z.string()),
    notes: z.array(z.string()),
  })
  .strict();

export const checkRowSchema = z
  .object({
    path: z.string(),
    status: z.enum(["ok", "missing", "warning", "error"]),
    message: z.string().optional(),
  })
  .strict();

export type ManagedFileRecord = z.infer<typeof managedFileRecordSchema>;
export type ManagedFilesReceipt = z.infer<typeof managedFilesReceiptSchema>;
export type NativeProject = z.infer<typeof nativeProjectSchema>;
export type FrameworkManifest = z.infer<typeof frameworkManifestSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
export type WorkspaceLayoutMode = z.infer<typeof workspaceLayoutModeSchema>;
export type WorkspacePrivacy = z.infer<typeof workspacePrivacySchema>;
export type WorkspaceLayoutPaths = z.infer<typeof workspaceLayoutPathsSchema>;
export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>;
