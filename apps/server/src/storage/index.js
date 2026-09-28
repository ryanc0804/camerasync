// Where uploaded recordings live. The driver is chosen from the environment so
// the same route code runs against local disk in development and S3 in
// production:
//
//   STORAGE_DRIVER=local|s3   explicit choice; defaults to s3 when S3_BUCKET
//                             is set and local otherwise
//   UPLOAD_DIR                local files (local driver) and the temp dir
//                             uploads are validated in (both drivers)
//
// Both drivers expose the same surface: incomingDir, put(), serve(),
// remove(), check() and describe(). See local.js and s3.js.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalStorage } from "./local.js";
import { createS3Storage } from "./s3.js";

const SERVER_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(SERVER_ROOT, "uploads");

const driver = (
  process.env.STORAGE_DRIVER || (process.env.S3_BUCKET ? "s3" : "local")
).toLowerCase();

if (driver !== "local" && driver !== "s3") {
  throw new Error(`Unknown STORAGE_DRIVER "${driver}". Expected "local" or "s3".`);
}

export const storage =
  driver === "s3"
    ? createS3Storage({ uploadDir: UPLOAD_DIR })
    : createLocalStorage({ uploadDir: UPLOAD_DIR });

console.log(`[storage] ${storage.describe()}`);

// Surface a bad bucket name or credentials at boot rather than on the first
// upload. Not fatal: the health check and the rest of the API still come up.
storage.check().catch((err) => {
  console.error(`[storage] check failed: ${err.message}`);
});
