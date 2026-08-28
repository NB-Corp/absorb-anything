import os from "node:os";
import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 120000,
    // Keep the machine-local clone registry out of the real home directory; a
    // test run must not write where the developer's own workspaces read.
    env: {
      ABSORB_CLONE_REGISTRY: path.join(
        os.tmpdir(),
        `absorb-core-tests-${process.pid}`,
        "clone-registry.json",
      ),
    },
  },
});
