const prisma = require('../config/db');
const { uploadToS3 } = require('../config/s3');

// GET /api/gallery - Get all gallery items
const getGallery = async (req, res) => {
  try {
    const { category, is_featured, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (category) where.category = category;
    if (is_featured === 'true') where.is_featured = true;

    const [items, total] = await Promise.all([
      prisma.gallery.findMany({
        where,
        include: {
          uploader: { select: { id: true, email: true } },
        },
        orderBy: [{ is_featured: 'desc' }, { display_order: 'asc' }, { created_at: 'desc' }],
        skip,
        take: parseInt(limit),
      }),
      prisma.gallery.count({ where }),
    ]);

    res.json({
      items,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/gallery/:id - Get single gallery item
const getGalleryItem = async (req, res) => {
  try {
    const item = await prisma.gallery.findUnique({
      where: { id: req.params.id },
      include: {
        uploader: { select: { id: true, email: true } },
      },
    });

    if (!item) return res.status(404).json({ error: 'Gallery item not found' });

    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/gallery - Create gallery item (Admin only)
const createGalleryItem = async (req, res) => {
  try {
    const { title, description, category, is_featured, display_order } = req.body;

    if (!title || !req.file) {
      return res.status(400).json({ error: 'Title and image are required' });
    }

    // Upload image to S3
    const { url } = await uploadToS3(req.file.buffer, req.file.originalname, 'gallery');

    const item = await prisma.gallery.create({
      data: {
        title,
        description,
        image_url: url,
        category: category || 'GENERAL',
        is_featured: is_featured || false,
        display_order: display_order || 0,
        uploaded_by: req.user.id,
      },
      include: {
        uploader: { select: { id: true, email: true } },
      },
    });

    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/gallery/:id - Update gallery item (Admin only)
const updateGalleryItem = async (req, res) => {
  try {
    const { title, description, category, is_featured, display_order } = req.body;

    const updateData = {};
    if (title) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (category) updateData.category = category;
    if (is_featured !== undefined) updateData.is_featured = is_featured;
    if (display_order !== undefined) updateData.display_order = display_order;

    // If new image uploaded, upload to S3
    if (req.file) {
      const { url } = await uploadToS3(req.file.buffer, req.file.originalname, 'gallery');
      updateData.image_url = url;
    }

    const item = await prisma.gallery.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        uploader: { select: { id: true, email: true } },
      },
    });

    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/gallery/:id - Delete gallery item (Admin only)
const deleteGalleryItem = async (req, res) => {
  try {
    await prisma.gallery.delete({ where: { id: req.params.id } });
    res.json({ message: 'Gallery item deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/gallery/:id/toggle-featured - Toggle featured status (Admin only)
const toggleFeatured = async (req, res) => {
  try {
    const item = await prisma.gallery.findUnique({
      where: { id: req.params.id },
    });

    if (!item) return res.status(404).json({ error: 'Gallery item not found' });

    const updated = await prisma.gallery.update({
      where: { id: req.params.id },
      data: { is_featured: !item.is_featured },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getGallery,
  getGalleryItem,
  createGalleryItem,
  updateGalleryItem,
  deleteGalleryItem,
  toggleFeatured,
};
