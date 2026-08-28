import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SEMANTIC_TOPICS,
  absorbAgentsBlock,
  initFramework,
  requireObjectSemantics,
  semanticDigest,
  semanticDigestSentence,
  semanticHints,
  withSemanticModel,
} from "../src/index.js";
import type { SemanticHintKey } from "../src/semantics.js";

const roots: string[] = [];

async function temporary(name: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `${name}-`));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("object semantics", () => {
  it.each(SEMANTIC_TOPICS)("defines complete %s semantics", (topic) => {
    const entry = requireObjectSemantics(topic);
    expect(entry.topic).toBe(topic);
    expect(entry.label.length).toBeGreaterThan(0);
    expect(entry.purpose.length).toBeGreaterThan(0);
    expect(entry.antiRule.length).toBeGreaterThan(0);
    expect(entry.whyItExists.length).toBeGreaterThan(0);
    expect(entry.whenNotToUse.length).toBeGreaterThan(0);
    expect(entry.commonMisuses.length).toBeGreaterThan(0);
    expect(entry.commands.length).toBeGreaterThan(0);
    expect(entry.commands.every((command) => command.startsWith("absorb "))).toBe(true);
  });

  it("normalizes topic input and names every valid topic on error", () => {
    expect(requireObjectSemantics(" SOURCE ").topic).toBe("source");
    expect(() => requireObjectSemantics("task")).toThrow(`Choose: ${SEMANTIC_TOPICS.join(", ")}`);
  });

  it("builds a digest with exactly the public object topics", () => {
    const digest = semanticDigest();
    expect(digest.map((entry) => entry.topic)).toEqual([...SEMANTIC_TOPICS]);
    expect(digest.every((entry) => semanticDigestSentence(entry).includes(entry.antiRule))).toBe(
      true,
    );
  });

  it("defines one nonempty point-of-use hint for every mutating command", () => {
    const keys: SemanticHintKey[] = [
      "source add",
      "source link",
      "source unlink",
      "source capture",
      "source import",
      "source sync",
      "source switch",
      "analysis new",
      "analysis close",
      "knowledge add",
    ];
    for (const key of keys) {
      const hints = semanticHints(key);
      expect(hints).toHaveLength(1);
      expect(hints[0]?.trim().length).toBeGreaterThan(0);
    }
  });

  it("attaches a named semantic model to an operational failure", () => {
    const message = withSemanticModel("Source cannot move", "sourceNotCheckoutBacked");
    expect(message).toContain("Source cannot move");
    expect(message).toContain("absorb import");
    expect(message).toContain("absorb capture");
  });

  it("projects every digest sentence into the managed AGENTS block", async () => {
    const root = await temporary("absorb-semantics-agents");
    await initFramework({ target: root, name: "semantics", agents: false });
    const block = await absorbAgentsBlock(root);
    for (const entry of semanticDigest()) expect(block).toContain(semanticDigestSentence(entry));
  });
});
