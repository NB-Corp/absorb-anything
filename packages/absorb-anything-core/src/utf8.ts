import { readFile } from "node:fs/promises";

import { FrameworkError } from "./errors.js";

export async function readUtf8File(file: string, label = "file"): Promise<string> {
  const bytes = await readFile(file);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new FrameworkError(`${label} is not valid UTF-8: ${file}`, {
      code: "IO_ERROR",
      cause: error,
    });
  }
}
