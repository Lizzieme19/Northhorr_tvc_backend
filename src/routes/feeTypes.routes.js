const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getAllFeeTypes,
  getFeeTypeById,
  createFeeType,
  updateFeeType,
  deleteFeeType,
} = require('../controllers/feeTypes.controller');

/**
 * @swagger
 * /api/fee-types:
 *   get:
 *     summary: List all fee types (Admin/Finance only)
 *     tags: [Fee Types]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: is_active
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of fee types
 */
router.get('/', authenticate, requireRoles('ADMIN', 'FINANCE'), getAllFeeTypes);

/**
 * @swagger
 * /api/fee-types/{id}:
 *   get:
 *     summary: Get fee type by ID (Admin/Finance only)
 *     tags: [Fee Types]
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
 *         description: Fee type details
 */
router.get('/:id', authenticate, requireRoles('ADMIN', 'FINANCE'), getFeeTypeById);

/**
 * @swagger
 * /api/fee-types:
 *   post:
 *     summary: Create fee type (Admin only)
 *     tags: [Fee Types]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               code:
 *                 type: string
 *               description:
 *                 type: string
 *               amount:
 *                 type: number
 *               is_required:
 *                 type: boolean
 *               applies_to:
 *                 type: string
 *                 enum: [ALL, SPECIFIC_COURSE, SPECIFIC_LEVEL]
 *               course_id:
 *                 type: string
 *               level:
 *                 type: string
 *               term_based:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Fee type created
 */
router.post('/', authenticate, requireRoles('ADMIN'), createFeeType);

/**
 * @swagger
 * /api/fee-types/{id}:
 *   patch:
 *     summary: Update fee type (Admin only)
 *     tags: [Fee Types]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               amount:
 *                 type: number
 *               is_active:
 *                 type: boolean
 *               is_required:
 *                 type: boolean
 *               applies_to:
 *                 type: string
 *               course_id:
 *                 type: string
 *               level:
 *                 type: string
 *               term_based:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Fee type updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN'), updateFeeType);

/**
 * @swagger
 * /api/fee-types/{id}:
 *   delete:
 *     summary: Delete fee type (Admin only)
 *     tags: [Fee Types]
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
 *         description: Fee type deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN'), deleteFeeType);

module.exports = router;
