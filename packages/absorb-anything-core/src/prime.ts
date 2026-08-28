import path from "node:path";

import { PRODUCT_VERSION } from "./constants.js";
import { loadManifest } from "./manifest.js";
import {
  SEMANTIC_DETAIL_COMMAND,
  SEMANTIC_TOPICS,
  type SemanticDigestEntry,
  type SemanticTopic,
  semanticDigest,
} from "./semantics.js";
import { type FrameworkStatusResult, getFrameworkStatus } from "./workspace.js";

export interface PrimeResult {
  readonly root: string;
  readonly workspace: FrameworkStatusResult | null;
  readonly cliVersion: string;
  readonly semantics: readonly SemanticDigestEntry[];
  readonly topics: readonly SemanticTopic[];
  readonly detailsCommand: string;
  readonly notes: readonly string[];
}

export async function primeWorkspace(options: { readonly root: string }): Promise<PrimeResult> {
  const root = path.resolve(options.root);
  const base = {
    root,
    cliVersion: PRODUCT_VERSION,
    semantics: semanticDigest(),
    topics: SEMANTIC_TOPICS,
    detailsCommand: SEMANTIC_DETAIL_COMMAND,
  };
  try {
    if (!(await loadManifest(root))) return { ...base, workspace: null, notes: [] };
    return { ...base, workspace: await getFrameworkStatus({ root }), notes: [] };
  } catch (error) {
    return {
      ...base,
      workspace: null,
      notes: [
        `workspace state could not be read: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
