/*

AWS S3 Middleware to handle file uploads and blobs

- Multipart uploading clips for faster playback and streaming
- Retrieving S3 file blobs using API methods

Configured through env variables (see .env.example):
  S3_BUCKET, AWS_REGION, and optionally S3_PREFIX plus AWS_ACCESS_KEY_ID /
  AWS_SECRET_ACCESS_KEY (otherwise the SDK's default credential chain is used,
  e.g. the EC2 instance role).

@Stephen M

*/

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const BUCKET = process.env.S3_BUCKET;
const PREFIX = (process.env.S3_PREFIX ?? "").replace(/^\/+|\/+$/g, "");

// Uploads go to S3 in production and to local disk otherwise.
export const useS3 = process.env.NODE_ENV === "production";

if (useS3 && !BUCKET) {
  throw new Error("S3_BUCKET must be set when NODE_ENV=production.");
}

let client;
function getClient() {
  client ??= new S3Client({
    region: process.env.AWS_REGION,
    // Only pass keys if provided in env
    ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            sessionToken: process.env.AWS_SESSION_TOKEN,
          },
        }
      : {}),
  });
  return client;
}

const objectKey = (fileId) => (PREFIX ? `${PREFIX}/${fileId}` : fileId);

// Multipart-uploads a stream/buffer to the bucket under `fileId`.
export async function uploadToS3({ fileId, body, contentType }) {
  const upload = new Upload({
    client: getClient(),
    params: {
      Bucket: BUCKET,
      Key: objectKey(fileId),
      Body: body,
      ContentType: contentType,
    },
    queueSize: 4,
    // at least 5MB
    partSize: 1024 * 1024 * 5,
    // abort the multipart upload if it fails so no orphaned parts are billed
    leavePartsOnError: false,
  });

  await upload.done();
}

// Fetches an object (optionally a byte range, for seeking). Returns null when
// the key doesn't exist. `body` is a Node readable stream.
export async function getFromS3(fileId, range) {
  try {
    const out = await getClient().send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: objectKey(fileId),
        Range: range,
      })
    );
    return {
      body: out.Body,
      contentLength: out.ContentLength,
      contentRange: out.ContentRange,
      partial: Boolean(out.ContentRange),
    };
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    // Range not satisfiable
    if (err.$metadata?.httpStatusCode === 416) {
      const e = new Error("Range not satisfiable");
      e.status = 416;
      throw e;
    }
    throw err;
  }
}
