const { S3Client } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  // Remove forcePathStyle for AWS S3 (only needed for Backblaze B2)
  // If using a custom endpoint, uncomment below:
  // endpoint: process.env.AWS_S3_ENDPOINT,
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

module.exports = { s3Client, BUCKET_NAME };
