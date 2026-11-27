import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withJackyunRunLock } from "../jackyun/run-lock";
import { assertNoJdManualVerifyWindowOpen, jdManualVerifyWindowMarkerPath } from "./manual-verify-window";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function defaultJdChromiumRunLockDirectory(root = projectRoot) {
  return path.join(root, ".runtime", "jd-chromium-global.lock");
}

export function defaultJdManualVerifyWindowMarkerPath(root?: string) {
  return jdManualVerifyWindowMarkerPath(defaultJdChromiumRunLockDirectory(root));
}

export async function withJdChromiumRunLock<T>(
  purpose: string,
  operation: () => Promise<T>,
  lockDirectory = defaultJdChromiumRunLockDirectory(),
) {
  return withJackyunRunLock({
    runId: `jd-chromium-${process.pid}-${randomUUID()}`,
    purpose,
    lockDirectory,
  }, async () => {
    // A visible manual-verification window shares the Chromium user-data root;
    // no automated stage may launch Chromium until it is closed or expires.
    await assertNoJdManualVerifyWindowOpen(jdManualVerifyWindowMarkerPath(lockDirectory));
    return operation();
  });
}
