const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getAssets,
  getAssetById,
  createAsset,
  updateAsset,
  calculateDepreciation,
  recordMaintenance,
  disposeAsset,
  deleteAsset,
} = require('../controllers/assets.controller');

/**
 * @swagger
 * /api/assets:
 *   get:
 *     summary: List assets (Admin/Procurement only)
 *     tags: [Procurement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: department_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, INACTIVE, DISPOSED]
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
 *         description: List of assets
 */
router.get('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), getAssets);

/**
 * @swagger
 * /api/assets:
 *   post:
 *     summary: Create asset (Admin/Procurement only)
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
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               serial_number:
 *                 type: string
 *               purchase_date:
 *                 type: string
 *                 format: date
 *               purchase_cost:
 *                 type: number
 *               location:
 *                 type: string
 *               department_id:
 *                 type: string
 *               depreciation_rate:
 *                 type: number
 *               useful_life:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Asset created
 */
router.post('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), createAsset);

/**
 * @swagger
 * /api/assets/{id}:
 *   get:
 *     summary: Get asset by ID
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
 *         description: Asset details
 */
router.get('/:id', authenticate, getAssetById);

/**
 * @swagger
 * /api/assets/{id}:
 *   patch:
 *     summary: Update asset (Admin/Procurement only)
 *     tags: [Procurement]
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
 *     responses:
 *       200:
 *         description: Asset updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), updateAsset);

/**
 * @swagger
 * /api/assets/{id}/depreciate:
 *   post:
 *     summary: Calculate and record depreciation (Admin/Procurement only)
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
 *         description: Depreciation calculated
 */
router.post('/:id/depreciate', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), calculateDepreciation);

/**
 * @swagger
 * /api/assets/{id}/maintenance:
 *   post:
 *     summary: Record maintenance (Admin/Procurement only)
 *     tags: [Procurement]
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
 *               maintenance_type:
 *                 type: string
 *               description:
 *                 type: string
 *               cost:
 *                 type: number
 *               performed_by:
 *                 type: string
 *               performed_date:
 *                 type: string
 *                 format: date
 *               next_due_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Maintenance recorded
 */
router.post('/:id/maintenance', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), recordMaintenance);

/**
 * @swagger
 * /api/assets/{id}/dispose:
 *   patch:
 *     summary: Dispose asset (Admin/Procurement only)
 *     tags: [Procurement]
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
 *               disposal_reason:
 *                 type: string
 *               disposal_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Asset disposed
 */
router.patch('/:id/dispose', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), disposeAsset);

/**
 * @swagger
 * /api/assets/{id}:
 *   delete:
 *     summary: Delete asset (Admin/Procurement only)
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
 *         description: Asset deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), deleteAsset);

module.exports = router;
