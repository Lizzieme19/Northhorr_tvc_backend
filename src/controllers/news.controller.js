const prisma = require('../config/db');
const { uploadToS3 } = require('../middleware/upload');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, BUCKET_NAME } = require('../config/s3');

// GET /api/news - Get all news (public)
const getAllNews = async (req, res) => {
  try {
    const { published = 'true', featured = 'false', category } = req.query;
    
    const where = {};
    if (published === 'true') {
      where.is_published = true;
    }
    if (featured === 'true') {
      where.is_featured = true;
    }
    if (category) {
      where.category = category;
    }

    const news = await prisma.news.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        uploader: {
          select: { id: true, email: true }
        }
      }
    });

    res.json({ news });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/news/:id - Get single news item
const getNewsById = async (req, res) => {
  try {
    const news = await prisma.news.findUnique({
      where: { id: req.params.id },
      include: {
        uploader: {
          select: { id: true, email: true }
        }
      }
    });

    if (!news) {
      return res.status(404).json({ error: 'News not found' });
    }

    res.json({ news });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/news - Create news (admin only)
const createNews = async (req, res) => {
  try {
    const { title, excerpt, content, category, is_featured, is_published } = req.body;
    const imageFile = req.file;

    if (!title || !excerpt || !category) {
      return res.status(400).json({ error: 'Title, excerpt, and category are required' });
    }

    let image_url = null;
    let image_key = null;

    if (imageFile) {
      const uploadResult = await uploadToS3(imageFile.buffer, imageFile.originalname, 'news');
      image_url = uploadResult.url;
      image_key = uploadResult.key;
    }

    const news = await prisma.news.create({
      data: {
        title,
        excerpt,
        content: content || null,
        category,
        image_url,
        image_key,
        is_featured: is_featured === 'true' || is_featured === true,
        is_published: is_published === 'true' || is_published === true,
        published_at: (is_published === 'true' || is_published === true) ? new Date() : null,
        uploaded_by: req.user.id
      },
      include: {
        uploader: {
          select: { id: true, email: true }
        }
      }
    });

    res.status(201).json({ news });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PUT /api/news/:id - Update news (admin only)
const updateNews = async (req, res) => {
  try {
    const { title, excerpt, content, category, is_featured, is_published } = req.body;
    const imageFile = req.file;

    const existingNews = await prisma.news.findUnique({
      where: { id: req.params.id }
    });

    if (!existingNews) {
      return res.status(404).json({ error: 'News not found' });
    }

    let image_url = existingNews.image_url;
    let image_key = existingNews.image_key;

    // Handle image replacement
    if (imageFile) {
      // Delete old image if exists
      if (existingNews.image_key) {
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: existingNews.image_key,
          }));
        } catch (err) {
          console.error('Failed to delete file from S3:', err);
        }
      }
      
      const uploadResult = await uploadToS3(imageFile.buffer, imageFile.originalname, 'news');
      image_url = uploadResult.url;
      image_key = uploadResult.key;
    }

    const updateData = {
      title: title !== undefined ? title : existingNews.title,
      excerpt: excerpt !== undefined ? excerpt : existingNews.excerpt,
      content: content !== undefined ? content : existingNews.content,
      category: category !== undefined ? category : existingNews.category,
      image_url,
      image_key,
      is_featured: is_featured !== undefined ? (is_featured === 'true' || is_featured === true) : existingNews.is_featured,
      is_published: is_published !== undefined ? (is_published === 'true' || is_published === true) : existingNews.is_published,
    };

    // Set published_at when publishing for the first time
    if (is_published === 'true' || is_published === true) {
      if (!existingNews.is_published) {
        updateData.published_at = new Date();
      }
    } else {
      updateData.published_at = null;
    }

    const news = await prisma.news.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        uploader: {
          select: { id: true, email: true }
        }
      }
    });

    res.json({ news });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/news/:id - Delete news (admin only)
const deleteNews = async (req, res) => {
  try {
    const news = await prisma.news.findUnique({
      where: { id: req.params.id }
    });

    if (!news) {
      return res.status(404).json({ error: 'News not found' });
    }

    // Delete image from S3 if exists
    if (news.image_key) {
      try {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: news.image_key,
        }));
      } catch (err) {
        console.error('Failed to delete file from S3:', err);
      }
    }

    await prisma.news.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'News deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllNews,
  getNewsById,
  createNews,
  updateNews,
  deleteNews
};
