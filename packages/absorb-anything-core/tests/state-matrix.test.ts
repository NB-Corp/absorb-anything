import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  addSource,
  checkFramework,
  closeAnalysis,
  createAnalysis,
  initFramework,
} from "../src/index.js";

const roots: string[] = [];
const tempDirs = {
  async createTempDir(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "absorb-state-rewrites-"));
    roots.push(root);
    return root;
  },
  async cleanup(): Promise<void> {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  },
};

afterEach(async () => {
  await tempDirs.cleanup();
});

async function workspace(name: string): Promise<string> {
  const root = path.join(await tempDirs.createTempDir(), name);
  await initFramework({ target: root, name, standalone: true, agents: false });
  return root;
}

async function directorySource(name: string, body = "# Source\n\nv1\n"): Promise<string> {
  const source = path.join(await tempDirs.createTempDir(), name);
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "README.md"), body, "utf8");
  return source;
}

async function onlyObservation(root: string, alias: string): Promise<string> {
  const dir = path.join(root, "sources", alias, "observations");
  const entries = await readdir(dir);
  const first = entries[0];
  if (!first) throw new Error(`no observation recorded for ${alias}`);
  return path.join(dir, first);
}

describe("analysis close writes the header status and the real decision checkbox", () => {
  it("closes the real status when a header line above it looks like one", async () => {
    const root = await workspace("AnalysisStatusDecoy");
    const created = await createAnalysis({
      root,
      title: "Status Decoy",
      now: new Date("2026-06-14T10:00:00"),
    });
    const original = await readFile(created.absolutePath, "utf8");
    await writeFile(
      created.absolutePath,
      original.replace(
        "- Status: draft\n",
        "- Upstream ticket: JIRA-1 - Status: unknown\n- Status: draft\n",
      ),
      "utf8",
    );

    await closeAnalysis({
      root,
      path: created.path,
      exit: "adopt",
      now: new Date("2026-06-15T10:00:00"),
    });

    const content = await readFile(created.absolutePath, "utf8");
    expect(content).toContain("- Status: applied");
    expect(content).not.toContain("- Status: draft");
    expect(content).toContain("- Upstream ticket: JIRA-1 - Status: unknown");
  });

  it("ticks the checkbox under Decision exit, not a lookalike above it", async () => {
    const root = await workspace("AnalysisCheckboxDecoy");
    const created = await createAnalysis({
      root,
      title: "Checkbox Decoy",
      now: new Date("2026-06-14T10:00:00"),
    });
    const original = await readFile(created.absolutePath, "utf8");
    await writeFile(
      created.absolutePath,
      original.replace(
        "## Key observations\n",
        "## Key observations\n\n- [ ] adopt upstream naming later\n",
      ),
      "utf8",
    );

    await closeAnalysis({
      root,
      path: created.path,
      exit: "adopt",
      now: new Date("2026-06-15T10:00:00"),
    });

    const content = await readFile(created.absolutePath, "utf8");
    expect(content).toContain("- [ ] adopt upstream naming later");
    const decisionSection = content.slice(content.indexOf("## Decision exit"));
    expect(decisionSection).toContain("- [x] adopt");
    expect(decisionSection).toContain("- [ ] reject");
  });

  it("refuses to close when the Decision exit section has no matching checkbox", async () => {
    const root = await workspace("AnalysisMissingCheckbox");
    const created = await createAnalysis({
      root,
      title: "Missing Checkbox",
      now: new Date("2026-06-14T10:00:00"),
    });
    const original = await readFile(created.absolutePath, "utf8");
    await writeFile(created.absolutePath, original.replace("- [ ] adopt\n", ""), "utf8");

    await expect(closeAnalysis({ root, path: created.path, exit: "adopt" })).rejects.toThrow(
      /Decision exit[\s\S]*'- \[ \] adopt' checkbox/,
    );

    // The refusal must leave the card untouched rather than half-closed.
    expect(await readFile(created.absolutePath, "utf8")).toContain("- Status: draft");
  });

  it("refuses malformed UTF-8 before rewriting the analysis or appending an event", async () => {
    const root = await workspace("AnalysisInvalidUtf8");
    const created = await createAnalysis({ root, title: "Invalid UTF-8" });
    const invalid = Buffer.from([0x23, 0x20, 0xff, 0x0a]);
    await writeFile(created.absolutePath, invalid);
    const events = path.join(root, ".absorb", "events");
    const beforeEvents = await readdir(events);

    await expect(closeAnalysis({ root, path: created.path, exit: "adopt" })).rejects.toThrow(
      "analysis file is not valid UTF-8",
    );

    expect(await readFile(created.absolutePath)).toEqual(invalid);
    expect(await readdir(events)).toEqual(beforeEvents);
  });
});

describe("closing on a decision suggests an identity pin without requiring one", () => {
  it("names the commit an adopt rested on when the card carries one", async () => {
    const root = await workspace("PinFromCommit");
    const source = await directorySource("pin-commit-source");
    await addSource({ root, source, alias: "up" });
    const created = await createAnalysis({ root, title: "Pin From Commit", forSource: "up" });
    // A checkout-backed card carries the commit; the header is what close reads,
    // so injecting it exercises the same path a Git source produces.
    const original = await readFile(created.absolutePath, "utf8");
    await writeFile(
      created.absolutePath,
      original.replace(
        "- Source observation:",
        `- Source commit: ${"c".repeat(40)}\n- Source observation:`,
      ),
      "utf8",
    );

    const closed = await closeAnalysis({ root, path: created.path, exit: "adopt" });

    expect(closed.pinSuggestion).toContain("`up` at cccccccccccc");
    expect(closed.pinSuggestion).not.toContain("absorb capture");
  });

  it("names both routes for copied content and requires neither", async () => {
    const root = await workspace("PinFromCopy");
    const source = await directorySource("pin-copy-source");
    await addSource({ root, source, alias: "up" });
    const created = await createAnalysis({ root, title: "Pin From Copy", forSource: "up" });

    const closed = await closeAnalysis({ root, path: created.path, exit: "reject" });

    expect(closed.pinSuggestion).toContain("absorb capture up");
    expect(closed.pinSuggestion).toContain("It is not required.");
  });

  it("suggests nothing for an experiment or an analysis bound to no source", async () => {
    const root = await workspace("PinAbsent");
    const source = await directorySource("pin-absent-source");
    await addSource({ root, source, alias: "up" });
    const bound = await createAnalysis({ root, title: "Still Looking", forSource: "up" });
    const unbound = await createAnalysis({ root, title: "No Source" });

    expect(
      (await closeAnalysis({ root, path: bound.path, exit: "experiment" })).pinSuggestion,
    ).toBeUndefined();
    expect(
      (await closeAnalysis({ root, path: unbound.path, exit: "adopt" })).pinSuggestion,
    ).toBeUndefined();
  });
});

describe("analysis.closed events describe only what happened", () => {
  it("never records allow_empty, whether or not the deprecated flag was passed", async () => {
    const root = await workspace("AllowEmptyEvent");
    const created = await createAnalysis({
      root,
      title: "Deprecated Flag",
      now: new Date("2026-06-14T10:00:00"),
    });

    const closed = await closeAnalysis({
      root,
      path: created.path,
      exit: "adopt",
      now: new Date("2026-06-15T10:00:00"),
    });

    const events = (await readFile(path.join(root, closed.eventFile), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const closeEvent = events.find((event) => event.event === "analysis.closed");
    expect(closeEvent).toBeDefined();
    expect(closeEvent).not.toHaveProperty("allow_empty");
  });
});

describe("check reports any source-ledger failure instead of skipping it", () => {
  it("fails on a source.yaml that is not a YAML mapping", async () => {
    const root = await workspace("LedgerNotObject");
    const source = await directorySource("ledger-not-object");
    await addSource({ root, source, alias: "up" });
    await writeFile(path.join(root, "sources", "up", "source.yaml"), "just a string\n", "utf8");

    const check = await checkFramework({ root });

    expect(check.ok).toBe(false);
    expect(
      check.rows.some(
        (row) =>
          row.path === "sources" &&
          row.status === "error" &&
          row.message?.includes("YAML file is not an object"),
      ),
    ).toBe(true);
  });

  it("fails on a source.yaml that cannot be parsed", async () => {
    const root = await workspace("LedgerUnparseable");
    const source = await directorySource("ledger-unparseable");
    await addSource({ root, source, alias: "up" });
    await writeFile(path.join(root, "sources", "up", "source.yaml"), "a: [1,\n  b: {\n", "utf8");

    const check = await checkFramework({ root });

    expect(check.ok).toBe(false);
    expect(check.rows.some((row) => row.path === "sources" && row.status === "error")).toBe(true);
  });

  it("fails on a source.yaml that is not valid UTF-8", async () => {
    const root = await workspace("LedgerInvalidUtf8");
    const source = await directorySource("ledger-invalid-utf8");
    await addSource({ root, source, alias: "up" });
    await writeFile(path.join(root, "sources", "up", "source.yaml"), Buffer.from([0xff, 0xfe]));

    const check = await checkFramework({ root });

    expect(check.ok).toBe(false);
    expect(
      check.rows.some((row) => row.path === "sources" && row.message?.includes("not valid UTF-8")),
    ).toBe(true);
  });
});

describe("check reads a source by what it holds, not by a stored fingerprint", () => {
  it("passes a source whose observation records no content hash at all", async () => {
    const root = await workspace("CheapObservation");
    const source = await directorySource("cheap-observation-source");
    await addSource({ root, source, alias: "up" });

    const observation = await readFile(await onlyObservation(root, "up"), "utf8");
    expect(observation).not.toContain("fingerprint:");
    expect((await checkFramework({ root })).ok).toBe(true);
  });

  it("fails when a source has no readable content left", async () => {
    const root = await workspace("MissingContent");
    const source = await directorySource("missing-content-source");
    await addSource({ root, source, alias: "up" });
    await rm(path.join(root, "sources", "up", "content"), { recursive: true, force: true });

    const check = await checkFramework({ root });
    expect(check.ok).toBe(false);
    expect(
      check.rows.some(
        (row) =>
          row.status === "error" &&
          row.path === "sources/up/content" &&
          row.message?.includes("no readable content"),
      ),
    ).toBe(true);
  });
});
