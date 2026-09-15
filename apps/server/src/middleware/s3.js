/*

AWS S3 Middleware to handle file uploads and blobs

- Multipart uploading clips for faster playback and streaming
- file stitching once video has fully uploaded
- Retrieving S3 file blobs using API methods

@Stephen M

*/

import { Upload } from '@aws-sdk/lib-storage'
import { S3Client, S3 } from '@aws-sdk/client-s3'

try {
  const parallelUploads3 = new Upload({
    client: new S3({}) || new S3Client({}),
    params: { Bucket, Key, Body },

    // optional tags
    tags: [/*...*/],

    // additional optional fields show default values below:

    // (optional) concurrency configuration
    queueSize: 4,

    // (optional) size of each part, in bytes, at least 5MB
    partSize: 1024 * 1024 * 5,

    // (optional) when true, do not automatically call AbortMultipartUpload when
    // a multipart upload fails to complete. You should then manually handle
    // the leftover parts.
    leavePartsOnError: false,
  });
try {
  const parallelUploads3 = new Upload({
    client: new S3({}) || new S3Client({}),
    params: { Bucket, Key, Body },

    // optional tags
    tags: [/*...*/],

    // additional optional fields show default values below:

    // (optional) concurrency configuration
    queueSize: 4,

    // (optional) size of each part, in bytes, at least 5MB
    partSize: 1024 * 1024 * 5,

    // (optional) when true, do not automatically call AbortMultipartUpload when
    // a multipart upload fails to complete. You should then manually handle
    // the leftover parts.
    leavePartsOnError: false,
  });

  parallelUploads3.on("httpUploadProgress", (progress) => {
    console.log(progress);
  });

  await parallelUploads3.done();
} catch (e) {
  console.log(e);
}
  parallelUploads3.on("httpUploadProgress", (progress) => {
    console.log(progress);
  });

  await parallelUploads3.done();
} catch (e) {
  console.log(e);
}