const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  approveSupplier,
} = require('../controllers/suppliers.controller');

/**
 * @swagger
 * /api/suppliers:
 *   get:
 *     summary: List all suppliers
 *     tags: [Procurement]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED]
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
 *         description: List of suppliers
 */
router.get('/', getSuppliers);

/**
 * @swagger
 * /api/suppliers:
 *   post:
 *     summary: Create new supplier (Admin/Procurement only)
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
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               category:
 *                 type: string
 *     responses:
 *       201:
 *         description: Supplier created
 */
router.post('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), createSupplier);

/**
 * @swagger
 * /api/suppliers/{id}/approve:
 *   patch:
 *     summary: Approve supplier (Admin/Procurement only)
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
 *         description: Supplier approved
 */
router.patch('/:id/approve', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), approveSupplier);

/**
 * @swagger
 * /api/suppliers/{id}:
 *   get:
 *     summary: Get supplier by ID
 *     tags: [Procurement]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Supplier details
 */
router.get('/:id', getSupplierById);

/**
 * @swagger
 * /api/suppliers/{id}:
 *   patch:
 *     summary: Update supplier (Admin/Procurement only)
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
 *         description: Supplier updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), updateSupplier);

/**
 * @swagger
 * /api/suppliers/{id}:
 *   delete:
 *     summary: Delete supplier (Admin/Procurement only)
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
 *         description: Supplier deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), deleteSupplier);

module.exports = router;
