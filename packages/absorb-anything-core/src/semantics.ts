import { FrameworkError } from "./errors.js";

export const SEMANTIC_TOPICS = ["workspace", "project", "source", "analysis", "knowledge"] as const;
export type SemanticTopic = (typeof SEMANTIC_TOPICS)[number];
export const SEMANTIC_DETAIL_COMMAND = "absorb explain <topic>";

export interface ObjectSemantics {
  readonly topic: SemanticTopic;
  readonly label: string;
  readonly purpose: string;
  readonly antiRule: string;
  readonly whyItExists: readonly string[];
  readonly whenNotToUse: readonly string[];
  readonly commonMisuses: readonly string[];
  readonly commands: readonly string[];
}

const OBJECTS: Record<SemanticTopic, ObjectSemantics> = {
  workspace: {
    topic: "workspace",
    label: "Workspace",
    purpose:
      "A versioned envelope that keeps source evidence, analysis, and reusable knowledge together.",
    antiRule: "Do not bypass the manifest when locating workspace areas.",
    whyItExists: ["It gives every command one fail-closed layout authority."],
    whenNotToUse: ["A transient note with no evidence lifecycle needs no workspace."],
    commonMisuses: ["Writing overlay work folders into the repository root."],
    commands: ["absorb init", "absorb check", "absorb status", "absorb update"],
  },
  project: {
    topic: "project",
    label: "Project",
    purpose: "The stable id and name of one workspace.",
    antiRule: "Project identity does not imply build-object registries.",
    whyItExists: ["Source references can identify the workspace that owns a source."],
    whenNotToUse: ["Do not store analysis or source state in project.yaml."],
    commonMisuses: ["Treating the identity record as a roadmap or task tracker."],
    commands: ["absorb status"],
  },
  source: {
    topic: "source",
    label: "Source",
    purpose: "External material with a stable lineage and durable observations.",
    antiRule: "One source has one home; links point to it instead of copying its identity.",
    whyItExists: ["Changes can be observed without losing the evidence used by earlier decisions."],
    whenNotToUse: ["Use Knowledge for material already accepted as reusable guidance."],
    commonMisuses: [
      "Importing over a Git checkout",
      "Unlinking a source owned by the current workspace",
    ],
    commands: ["absorb add", "absorb sync", "absorb link", "absorb capture"],
  },
  analysis: {
    topic: "analysis",
    label: "Analysis",
    purpose: "A bounded interpretation of source evidence that ends with an explicit exit.",
    antiRule: "An analysis is working reasoning, not accepted knowledge.",
    whyItExists: ["It connects observations to an explicit decision."],
    whenNotToUse: ["A byte capture does not require interpretation."],
    commonMisuses: ["Leaving accepted guidance only in a closed analysis."],
    commands: ["absorb analysis new", "absorb analysis close"],
  },
  knowledge: {
    topic: "knowledge",
    label: "Knowledge",
    purpose: "Reusable guidance retained after analysis.",
    antiRule: "Keep drafts and raw source material out of Knowledge.",
    whyItExists: ["Future work can reuse conclusions without replaying the entire investigation."],
    whenNotToUse: ["Use Analysis while the conclusion is still being tested."],
    commonMisuses: ["Copying unreviewed source text directly into Knowledge."],
    commands: ["absorb knowledge add"],
  },
};

export interface SemanticDigestEntry {
  readonly topic: SemanticTopic;
  readonly label: string;
  readonly purpose: string;
  readonly antiRule: string;
}

export function semanticDigest(): SemanticDigestEntry[] {
  return SEMANTIC_TOPICS.map((topic) => {
    const { label, purpose, antiRule } = OBJECTS[topic];
    return { topic, label, purpose, antiRule };
  });
}

export function semanticDigestSentence(entry: SemanticDigestEntry): string {
  return `${entry.label}: ${entry.purpose} Rule: ${entry.antiRule}`;
}

export function requireObjectSemantics(topic: string): ObjectSemantics {
  const normalized = topic.trim().toLowerCase();
  if (!SEMANTIC_TOPICS.includes(normalized as SemanticTopic)) {
    throw new FrameworkError(`Unknown topic '${topic}'. Choose: ${SEMANTIC_TOPICS.join(", ")}.`);
  }
  return OBJECTS[normalized as SemanticTopic];
}

export const SEMANTIC_MODELS = {
  sourceNotCheckoutBacked:
    "Only a Git-backed Source has a checkout to move; replace copied content with `absorb import <alias> <dir>`, or preserve it with `absorb capture <alias>`.",
  sourceCopyContentOnly:
    "Import replaces copied content; a checkout follows its upstream through sync or switch.",
  sourceCaptureMissing: "A capture's manifest and bytes form one byte-level record.",
  sourceReferenceBroken:
    "A reference points to one Source home and does not duplicate source state; recreate the shell with `absorb link` after locating that home.",
  sourceOwnedHere:
    "An owned Source is changed in the workspace that holds it; unlink removes references only.",
} as const;
export type SemanticModelKey = keyof typeof SEMANTIC_MODELS;

export function withSemanticModel(message: string, key: SemanticModelKey): string {
  return `${message}. ${SEMANTIC_MODELS[key]}`;
}

export function evidencePinSuggestion(input: {
  readonly alias: string;
  readonly commit: string | null;
}): string {
  return input.commit
    ? `Pin: this rests on \`${input.alias}\` at ${input.commit.slice(0, 12)}.`
    : `Pin: \`${input.alias}\` is copied content; \`absorb capture ${input.alias}\` preserves its bytes. It is not required.`;
}

export type SemanticHintKey =
  | "source add"
  | "source link"
  | "source unlink"
  | "source capture"
  | "source import"
  | "source sync"
  | "source switch"
  | "analysis new"
  | "analysis close"
  | "knowledge add";

const HINTS: Record<SemanticHintKey, readonly string[]> = {
  "source add": [
    "Observe changes with `absorb sync`; preserve decision-critical bytes with `absorb capture`.",
  ],
  "source link": ["The linked workspace remains the only Source home."],
  "source unlink": ["Unlink removes only the local reference shell."],
  "source capture": ["A capture is a byte-level record, not a semantic approval."],
  "source import": ["Import replaces copied content and records a new observation."],
  "source sync": ["Sync moves checkout-backed content and records what changed."],
  "source switch": ["Switch changes the checkout ref; add `--sync` to record an observation."],
  "analysis new": ["Close the analysis with an explicit decision exit."],
  "analysis close": ["Promote only conclusions that should become reusable Knowledge."],
  "knowledge add": ["Keep raw evidence in Sources and working reasoning in Analysis."],
};

export function semanticHints(key: SemanticHintKey): readonly string[] {
  return HINTS[key];
}
