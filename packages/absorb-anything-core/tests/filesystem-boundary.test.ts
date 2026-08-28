import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { identitySafePathNamesOpenFile, identitySafeRealpath } from "../src/filesystem-boundary.js";
import { checkFramework, initFramework } from "../src/index.js";

const roots: string[] = [];
const execute = promisify(execFile);

async function windowsShortPath(target: string): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const script = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AbsorbPathNative {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetShortPathName(string longPath, StringBuilder shortPath, uint size);
}
'@
$buffer = New-Object System.Text.StringBuilder 32768
$length = [AbsorbPathNative]::GetShortPathName($args[0], $buffer, $buffer.Capacity)
if ($length -eq 0) { exit 2 }
$buffer.ToString()
`;
  try {
    const { stdout } = await execute("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
      target,
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("identity-safe filesystem boundaries", () => {
  it("accepts a Windows DOS short-name workspace alias without accepting redirects", async () => {
    if (process.platform !== "win32") return;
    const temp = path.resolve(os.tmpdir());
    const shortTemp = await windowsShortPath(temp);
    if (!shortTemp || !/~[0-9]+(?:\\|$)/i.test(shortTemp)) return;

    await expect(identitySafeRealpath(shortTemp)).resolves.toMatchObject({
      windowsShortPathAlias: true,
    });
    const parent = await mkdtemp(path.join(shortTemp, "absorb-short-path-"));
    roots.push(parent);
    const root = path.join(parent, "workspace");
    await initFramework({ target: root, name: "Short Path", agents: false });
    await expect(checkFramework({ root })).resolves.toMatchObject({ ok: true });
  });

  it("accepts an ordinary path and rejects a symlink or junction", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "absorb-identity-boundary-"));
    roots.push(root);
    const target = path.join(root, "target");
    const redirect = path.join(root, "redirect");
    await mkdir(target);
    await symlink(target, redirect, process.platform === "win32" ? "junction" : "dir");

    await expect(identitySafeRealpath(target)).resolves.toEqual(
      expect.objectContaining({ resolved: path.resolve(target), canonical: expect.any(String) }),
    );
    await expect(identitySafeRealpath(redirect)).resolves.toBeNull();
  });

  it("binds an open authority file to its current name and rejects replacement", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "absorb-open-identity-"));
    roots.push(root);
    const target = path.join(root, "authority.json");
    const displaced = path.join(root, "authority.old.json");
    await writeFile(target, "old\n", "utf8");

    const safePath = await identitySafeRealpath(target);
    expect(safePath).not.toBeNull();
    if (!safePath) throw new Error("ordinary authority path was rejected");
    const handle = await open(target, "r");
    try {
      await expect(identitySafePathNamesOpenFile(target, handle, safePath)).resolves.toBe(true);
      await rename(target, displaced);
      await writeFile(target, "new\n", "utf8");
      await expect(identitySafePathNamesOpenFile(target, handle, safePath)).resolves.toBe(false);
    } finally {
      await handle.close();
    }
  });
});
