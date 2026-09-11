const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { upload } = require('../middleware/upload');
const {
  getTemplates,
  getTemplateByType,
  updateTemplate,
} = require('../controllers/documentTemplates.controller');

/**
 * @swagger
 * /api/document-templates:
 *   get:
 *     summary: List all document templates
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of document templates
 */
router.get('/', authenticate, requireRoles('ADMIN'), getTemplates);

/**
 * @swagger
 * /api/document-templates/{type}:
 *   get:
 *     summary: Get document template by type
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Document template
 */
router.get('/:type', authenticate, requireRoles('ADMIN'), getTemplateByType);

/**
 * @swagger
 * /api/document-templates/{type}:
 *   patch:
 *     summary: Update document template
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               text_blocks:
 *                 type: string
 *                 description: JSON string of text blocks
 *               ministry_logo:
 *                 type: string
 *                 format: binary
 *               college_logo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Updated document template
 */
router.patch('/:type', authenticate, requireRoles('ADMIN'), upload.fields([
  { name: 'ministry_logo', maxCount: 1 },
  { name: 'college_logo', maxCount: 1 }
]), updateTemplate);

module.exports = router;
