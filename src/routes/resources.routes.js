const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { upload } = require('../middleware/upload');
const {
  getResources,
  getResourceById,
  createResource,
  deleteResource,
  downloadResource,
} = require('../controllers/resources.controller');

/**
 * @swagger
 * /api/resources:
 *   get:
 *     summary: Get all resources
 *     tags: [Resources]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [Prospectus, Forms, Timetables, Policies]
 *         description: Filter by category
 *     responses:
 *       200:
 *         description: List of resources
 */
router.get('/', getResources);

/**
 * @swagger
 * /api/resources/{id}:
 *   get:
 *     summary: Get single resource
 *     tags: [Resources]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resource details
 *       404:
 *         description: Resource not found
 */
router.get('/:id', getResourceById);

/**
 * @swagger
 * /api/resources/{id}/download:
 *   get:
 *     summary: Download resource
 *     tags: [Resources]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirect to S3 file URL
 *       404:
 *         description: Resource not found
 */
router.get('/:id/download', downloadResource);

/**
 * @swagger
 * /api/resources:
 *   post:
 *     summary: Upload new resource
 *     tags: [Resources]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - title
 *               - category
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *                 enum: [Prospectus, Forms, Timetables, Policies]
 *     responses:
 *       201:
 *         description: Resource created successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin only
 */
router.post('/', authenticate, requireRoles('ADMIN'), upload.single('file'), createResource);

/**
 * @swagger
 * /api/resources/{id}:
 *   delete:
 *     summary: Delete resource
 *     tags: [Resources]
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
 *         description: Resource deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin only
 *       404:
 *         description: Resource not found
 */
router.delete('/:id', authenticate, requireRoles('ADMIN'), deleteResource);

module.exports = router;
