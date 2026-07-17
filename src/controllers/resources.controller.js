const prisma = require('../config/db');
const { uploadToS3 } = require('../middleware/upload');
const { DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, BUCKET_NAME } = require('../config/s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// GET /api/resources - List all resources (public)
const getResources = async (req, res) => {
  try {
    const { category } = req.query;
    const where = category ? { category } : {};

    const resources = await prisma.resource.findMany({
      where,
      include: {
        uploader: {
          select: { email: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    res.json(resources);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/resources/:id - Get single resource (public)
const getResourceById = async (req, res) => {
  try {
    const resource = await prisma.resource.findUnique({
      where: { id: req.params.id },
      include: {
        uploader: {
          select: { email: true },
        },
      },
    });

    if (!resource) return res.status(404).json({ error: 'Resource not found' });

    res.json(resource);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/resources - Upload new resource (Admin only)
const createResource = async (req, res) => {
  try {
    const { title, description, category } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!title || !category) {
      return res.status(400).json({ error: 'Title and category are required' });
    }

    // Upload file to S3
    const uploadResult = await uploadToS3(file.buffer, file.originalname, 'resources');

    // Get file type from original name
    const fileExt = file.originalname.split('.').pop().toUpperCase();
    const fileType = ['PDF', 'DOCX', 'DOC', 'ZIP', 'XLSX', 'XLS'].includes(fileExt) ? fileExt : 'FILE';

    // Format file size
    const fileSize = (file.size / 1024 / 1024).toFixed(2) + ' MB';

    const resource = await prisma.resource.create({
      data: {
        title,
        description,
        category,
        file_url: uploadResult.url,
        file_key: uploadResult.key,
        file_type: fileType,
        file_size: fileSize,
        uploaded_by: req.user.id,
      },
      include: {
        uploader: {
          select: { email: true },
        },
      },
    });

    res.status(201).json(resource);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/resources/:id - Delete resource (Admin only)
const deleteResource = async (req, res) => {
  try {
    const resource = await prisma.resource.findUnique({
      where: { id: req.params.id },
    });

    if (!resource) return res.status(404).json({ error: 'Resource not found' });

    // Delete file from S3
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: resource.file_key,
        })
      );
    } catch (s3Error) {
      console.warn('Failed to delete from S3:', s3Error.message);
    }

    // Delete from database
    await prisma.resource.delete({
      where: { id: req.params.id },
    });

    res.json({ message: 'Resource deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/resources/:id/download - Download resource (public)
const downloadResource = async (req, res) => {
  try {
    const resource = await prisma.resource.findUnique({
      where: { id: req.params.id },
    });

    if (!resource) return res.status(404).json({ error: 'Resource not found' });

    // Redirect to the S3 URL for direct download
    res.redirect(resource.file_url);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getResources,
  getResourceById,
  createResource,
  deleteResource,
  downloadResource,
};
