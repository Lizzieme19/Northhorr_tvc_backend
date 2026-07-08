const multer = require('multer');
const { s3Client, BUCKET_NAME } = require('../config/b2');
const { Upload } = require('@aws-sdk/lib-storage');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Use memory storage for immediate buffer access
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${ext}. Allowed: PDF, JPG, PNG`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

/**
 * Upload a buffer to AWS S3, fallback to local disk on timeout
 */
const uploadToB2 = async (buffer, originalName, folder = 'uploads') => {
  const ext = path.extname(originalName).toLowerCase();
  const key = `${folder}/${uuidv4()}${ext}`;
  const contentType = ext === '.pdf' ? 'application/pdf'
    : ext === '.png' ? 'image/png'
    : 'image/jpeg';

  try {
    const uploader = new Upload({
      client: s3Client,
      params: {
        Bucket: BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      },
    });

    // Timeout after 8 seconds to trigger fallback if network is unreachable
    const uploadPromise = uploader.done();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('S3 Upload Timeout')), 8000));
    
    await Promise.race([uploadPromise, timeoutPromise]);

    // AWS S3 URL format
    const region = process.env.AWS_REGION || 'us-east-1';
    const url = `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;
    return { key, url };
  } catch (error) {
    console.warn(`S3 Upload Failed (${error.message}), falling back to local storage for ${originalName}`);
    
    // Fallback to local storage
    const localDir = path.join(__dirname, '../../public', folder);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    const localPath = path.join(localDir, `${uuidv4()}${ext}`);
    fs.writeFileSync(localPath, buffer);
    
    const url = `${process.env.FRONTEND_URL}/${folder}/${path.basename(localPath)}`;
    return { key: localPath, url };
  }
};

const uploadDocuments = async (files, folder = 'documents') => {
  const results = {};
  for (const [fieldName, fileArray] of Object.entries(files)) {
    const file = Array.isArray(fileArray) ? fileArray[0] : fileArray;
    if (file && file.buffer) {
      results[fieldName] = await uploadToB2(file.buffer, file.originalname, folder);
    }
  }
  return results;
};

module.exports = { upload, uploadToB2, uploadDocuments };
