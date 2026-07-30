// file and upload API

// TODO: Swap with S3 for deployment phase

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/requireAuth.js";

export const fileRouter = Router();

// 2048 MB upload limit
const MAX_UPLOAD_BYTES = 2048 * 1024 * 1024;

// upload directory
const SERVER_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(SERVER_ROOT, "uploads");

// Only accept these file types to avoid malicious uploads
const MEDIA_TYPES = {
  ".mp4": { family: "isobmff", mime: "video/mp4" },
  ".m4v": { family: "isobmff", mime: "video/x-m4v" },
  ".mov": { family: "isobmff", mime: "video/quicktime" },
  ".3gp": { family: "isobmff", mime: "video/3gpp" },
  ".mkv": { family: "ebml", mime: "video/x-matroska" },
  ".webm": { family: "ebml", mime: "video/webm" },
  ".avi": { family: "riff", mime: "video/x-msvideo" },
  ".mpeg": { family: "mpeg", mime: "video/mpeg" },
  ".mpg": { family: "mpeg", mime: "video/mpeg" },
};

const ALLOWED_EXTENSIONS = Object.keys(MEDIA_TYPES);

// Handle MIME types across different browsers
const GENERIC_MIME_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "",
]);

// Regex to handle directory escape attempts or scraping
const FILE_ID_PATTERN = /^[0-9a-f]{32}\.[a-z0-9]{2,4}$/;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Reads the container family from a file's leading bytes. Returns null when
// the bytes don't look like any media container we accept.
function sniffContainerFamily(header) {
  if (header.length >= 12 && header.toString("latin1", 4, 8) === "ftyp") {
    return "isobmff";
  }
  if (
    header.length >= 4 &&
    header[0] === 0x1a &&
    header[1] === 0x45 &&
    header[2] === 0xdf &&
    header[3] === 0xa3
  ) {
    return "ebml";
  }
  if (
    header.length >= 12 &&
    header.toString("latin1", 0, 4) === "RIFF" &&
    header.toString("latin1", 8, 12) === "AVI "
  ) {
    return "riff";
  }
  // MPEG stream (00 00 01 BA), elementary stream (00 00 01 B3), or
  // transport stream (0x47 sync byte every 188 bytes).
  if (
    header.length >= 4 &&
    header[0] === 0x00 &&
    header[1] === 0x00 &&
    header[2] === 0x01 &&
    (header[3] === 0xba || header[3] === 0xb3)
  ) {
    return "mpeg";
  }
  if (header.length >= 189 && header[0] === 0x47 && header[188] === 0x47) {
    return "mpeg";
  }
  return null;
}

// Reads enough of a stored file to identify its container.
async function readHeader(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// Best-effort cleanup; a file that is already gone is not an error.
async function discard(filePath) {
  if (!filePath) return;
  await fsp.rm(filePath, { force: true }).catch(() => {});
}

// Marks the rejections that should surface as 415 rather than 500.
class UnsupportedMediaError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedMediaError";
  }
}

// Multer upload parameters
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID().replace(/-/g, "")}${ext}`);
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 0,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!Object.hasOwn(MEDIA_TYPES, ext)) {
      return cb(new UnsupportedMediaError(
        `Unsupported file type. Allowed extensions: ${ALLOWED_EXTENSIONS.join(", ")}.`
      ));
    }

    const mime = String(file.mimetype ?? "").toLowerCase();
    if (!mime.startsWith("video/") && !GENERIC_MIME_TYPES.has(mime)) {
      return cb(new UnsupportedMediaError(
        `Unsupported content type "${file.mimetype}". Only media files are accepted.`
      ));
    }

    cb(null, true);
  },
});

// Serve a previously uploaded file from local disk.
// TODO: stream from S3 instead once uploads move off the local filesystem.
fileRouter.get("/get/:fileId", requireAuth, async (req, res, next) => {
  const fileId = String(req.params.fileId ?? "").toLowerCase();

  if (!FILE_ID_PATTERN.test(fileId)) {
    return res.status(400).json({ error: "File ID is invalid." });
  }

  const ext = path.extname(fileId);
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) {
    return res.status(400).json({ error: "File ID is invalid." });
  }

  const filePath = path.join(UPLOAD_DIR, fileId);
  try {
    await fsp.access(filePath, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ error: "File not found." });
  }

  res.type(mediaType.mime);
  // sendFile handles range requests, which players need to seek.
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) next(err);
  });
});

// Handle file uploads (locally for now, S3 later).
fileRouter.post(
  "/upload",
  requireAuth,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (!err) return next();

      if (err instanceof UnsupportedMediaError) {
        return res.status(415).json({ error: err.message });
      }
      if (err instanceof multer.MulterError) {
        switch (err.code) {
          case "LIMIT_FILE_SIZE":
            return res.status(413).json({
              error: `File is too large. The limit is ${
                MAX_UPLOAD_BYTES / (1024 * 1024)
              } MB.`,
            });
          case "LIMIT_FILE_COUNT":
          case "LIMIT_UNEXPECTED_FILE":
            return res.status(400).json({
              error: 'Send exactly one file in a "file" field.',
            });
          case "LIMIT_FIELD_COUNT":
            return res.status(400).json({
              error: "Extra form fields are not accepted.",
            });
          default:
            return res.status(400).json({ error: "Upload was rejected." });
        }
      }
      next(err);
    });
  },
  async (req, res, next) => {
    // reject if no file found
    if (!req.file) {
      return res.status(400).json({ error: 'A "file" field is required.' });
    }

    const filePath = req.file.path;
    try {
      // Handle bytes and file checksum verification to ensure theres no spoofing
      const expectedFamily = MEDIA_TYPES[path.extname(req.file.filename)].family;
      const family = sniffContainerFamily(await readHeader(filePath));

      if (family !== expectedFamily) {
        await discard(filePath);
        return res.status(415).json({
          error: "File contents are not a supported media file.",
        });
      }

      res.status(201).json({
        file: {
          id: req.file.filename,
          originalName: req.file.originalname,
          contentType: MEDIA_TYPES[path.extname(req.file.filename)].mime,
          size: req.file.size,
          url: `/api/files/get/${req.file.filename}`,
          uploadedBy: req.user.id,
          uploadedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      await discard(filePath);
      next(err);
    }
  }
);
