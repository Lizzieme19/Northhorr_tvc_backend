const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getInventory,
  getReorderAlerts,
  getInventoryItemById,
  createInventoryItem,
  updateInventoryItem,
  adjustStock,
  deleteInventoryItem,
} = require('../controllers/inventory.controller');

/**
 * @swagger
 * /api/inventory:
 *   get:
 *     summary: List inventory items (Admin/Procurement only)
 *     tags: [Procurement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
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
 *         description: List of inventory items
 */
router.get('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), getInventory);

/**
 * @swagger
 * /api/inventory/alerts:
 *   get:
 *     summary: Get reorder alerts (Admin/Procurement only)
 *     tags: [Procurement]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of items needing reorder
 */
router.get('/alerts', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), getReorderAlerts);

/**
 * @swagger
 * /api/inventory:
 *   post:
 *     summary: Create inventory item (Admin/Procurement only)
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
 *               item_code:
 *                 type: string
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *               unit:
 *                 type: string
 *               quantity:
 *                 type: number
 *               reorder_level:
 *                 type: number
 *               unit_cost:
 *                 type: number
 *     responses:
 *       201:
 *         description: Inventory item created
 */
router.post('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), createInventoryItem);

/**
 * @swagger
 * /api/inventory/{id}:
 *   get:
 *     summary: Get inventory item by ID
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
 *         description: Inventory item details
 */
router.get('/:id', authenticate, getInventoryItemById);

/**
 * @swagger
 * /api/inventory/{id}:
 *   patch:
 *     summary: Update inventory item (Admin/Procurement only)
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
 *         description: Inventory item updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), updateInventoryItem);

/**
 * @swagger
 * /api/inventory/{id}/adjust:
 *   post:
 *     summary: Adjust stock level (Admin/Procurement only)
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
 *               quantity:
 *                 type: number
 *               adjustment_type:
 *                 type: string
 *                 enum: [ADD, REMOVE]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Stock adjusted
 */
router.post('/:id/adjust', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), adjustStock);

/**
 * @swagger
 * /api/inventory/{id}:
 *   delete:
 *     summary: Delete inventory item (Admin/Procurement only)
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
 *         description: Inventory item deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), deleteInventoryItem);

module.exports = router;
