const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const upload = require('../middleware/upload');
const {
  getGallery,
  getGalleryItem,
  createGalleryItem,
  updateGalleryItem,
  deleteGalleryItem,
  toggleFeatured,
} = require('../controllers/gallery.controller');

/**
 * @swagger
 * /api/gallery:
 *   get:
 *     summary: Get all gallery items (Public)
 *     tags: [Gallery]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: is_featured
 *         schema:
 *           type: boolean
 *         description: Filter featured items
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page
 *     responses:
 *       200:
 *         description: List of gallery items
 */
router.get('/', getGallery);

/**
 * @swagger
 * /api/gallery/{id}:
 *   get:
 *     summary: Get single gallery item (Public)
 *     tags: [Gallery]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Gallery item details
 */
router.get('/:id', getGalleryItem);

/**
 * @swagger
 * /api/gallery:
 *   post:
 *     summary: Create gallery item (Admin only)
 *     tags: [Gallery]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               is_featured:
 *                 type: boolean
 *               display_order:
 *                 type: integer
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Gallery item created
 */
router.post('/', authenticate, requireRoles('ADMIN'), upload.single('image'), createGalleryItem);

/**
 * @swagger
 * /api/gallery/{id}:
 *   patch:
 *     summary: Update gallery item (Admin only)
 *     tags: [Gallery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               is_featured:
 *                 type: boolean
 *               display_order:
 *                 type: integer
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Gallery item updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN'), upload.single('image'), updateGalleryItem);

/**
 * @swagger
 * /api/gallery/{id}:
 *   delete:
 *     summary: Delete gallery item (Admin only)
 *     tags: [Gallery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Gallery item deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN'), deleteGalleryItem);

/**
 * @swagger
 * /api/gallery/{id}/toggle-featured:
 *   patch:
 *     summary: Toggle featured status (Admin only)
 *     tags: [Gallery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Featured status toggled
 */
router.patch('/:id/toggle-featured', authenticate, requireRoles('ADMIN'), toggleFeatured);

module.exports = router;
