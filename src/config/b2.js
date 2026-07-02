const { S3Client } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: process.env.B2_REGION,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
  forcePathStyle: true, // Required for Backblaze B2
});

const BUCKET_NAME = process.env.B2_BUCKET_NAME;

module.exports = { s3Client, BUCKET_NAME };
