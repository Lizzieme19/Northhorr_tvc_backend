const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getGRNs,
  getGRNById,
  createGRN,
  verifyGRN,
  updateGRNItem,
  deleteGRN,
  generateGRNPDF,
} = require('../controllers/grns.controller');

/**
 * @swagger
 * /api/grns:
 *   get:
 *     summary: List GRNs (Admin/Procurement only)
 *     tags: [Procurement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, VERIFIED, REJECTED]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of GRNs
 */
router.get('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), getGRNs);

/**
 * @swagger
 * /api/grns:
 *   post:
 *     summary: Create GRN (Admin/Procurement only)
 *     tags: [Procurement]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               lpo_id:
 *                 type: string
 *               received_date:
 *                 type: string
 *                 format: date
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: GRN created
 */
router.post('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), createGRN);

/**
 * @swagger
 * /api/grns/{id}:
 *   get:
 *     summary: Get GRN by ID
 *     tags: [Procurement]
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
 *         description: GRN details
 */
router.get('/:id', authenticate, getGRNById);

/**
 * @swagger
 * /api/grns/{id}/pdf:
 *   get:
 *     summary: Generate GRN PDF document
 *     tags: [Procurement]
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
 *         description: GRN PDF
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/:id/pdf', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), generateGRNPDF);

/**
 * @swagger
 * /api/grns/{id}/verify:
 *   patch:
 *     summary: Verify GRN (Admin/Procurement only)
 *     tags: [Procurement]
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
 *         description: GRN verified
 */
/**
 * @swagger
 * /api/grns/{id}/items/{itemId}:
 *   patch:
 *     summary: Say what a received line is (consumable or asset, unit of measure) or correct its quantities, while the GRN is pending
 *     tags: [GRNs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: itemId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Updated line
 */
router.patch('/:id/items/:itemId', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), updateGRNItem);

router.patch('/:id/verify', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), verifyGRN);

/**
 * @swagger
 * /api/grns/{id}:
 *   delete:
 *     summary: Delete GRN (Admin/Procurement only)
 *     tags: [Procurement]
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
 *         description: GRN deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), deleteGRN);

module.exports = router;
