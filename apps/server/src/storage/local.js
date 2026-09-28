// Local-disk storage driver: recordings live as files under UPLOAD_DIR.
// Used in development and as the fallback when no S3 bucket is configured.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export function createLocalStorage({ uploadDir }) {
  // multer writes here first; put() renames into uploadDir once the file has
  // passed validation. Same volume, so the rename is atomic.
  const incomingDir = path.join(uploadDir, "incoming");
  fs.mkdirSync(incomingDir, { recursive: true });
  sweepIncoming(incomingDir);

  return {
    driver: "local",
    incomingDir,

    describe: () => `local disk at ${uploadDir}`,

    async check() {
      await fsp.access(uploadDir, fs.constants.W_OK);
    },

    async put({ fileId, tempPath }) {
      await fsp.rename(tempPath, path.join(uploadDir, fileId));
    },

    // sendFile handles range requests, which players need to seek.
    async serve(req, res, next, { fileId, contentType }) {
      const filePath = path.join(uploadDir, fileId);
      try {
        await fsp.access(filePath, fs.constants.R_OK);
      } catch {
        return res.status(404).json({ error: "File not found." });
      }
      res.type(contentType);
      res.sendFile(filePath, (err) => {
        if (err && !res.headersSent) next(err);
      });
    },

    async remove(fileIds) {
      for (const fileId of fileIds) {
        await fsp.rm(path.join(uploadDir, fileId), { force: true });
      }
    },
  };
}

// An upload interrupted by a crash leaves its temp file behind. Nothing can be
// mid-upload while the server is starting, so anything here is garbage.
function sweepIncoming(incomingDir) {
  for (const name of fs.readdirSync(incomingDir)) {
    fs.rmSync(path.join(incomingDir, name), { force: true });
  }
}
