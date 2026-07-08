const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getInvoices,
  getInvoiceById,
  createInvoice,
  updateInvoice,
  recordPayment,
  deleteInvoice,
} = require('../controllers/invoices.controller');

/**
 * @swagger
 * /api/invoices:
 *   get:
 *     summary: List supplier invoices (Admin/Procurement/Finance only)
 *     tags: [Procurement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PARTIAL, PAID, OVERDUE]
 *       - in: query
 *         name: supplier_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: lpo_id
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
 *         description: List of invoices
 */
router.get('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT', 'FINANCE'), getInvoices);

/**
 * @swagger
 * /api/invoices:
 *   post:
 *     summary: Create supplier invoice (Admin/Procurement only)
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
 *               supplier_id:
 *                 type: string
 *               invoice_no:
 *                 type: string
 *               amount:
 *                 type: number
 *               currency:
 *                 type: string
 *               invoice_date:
 *                 type: string
 *                 format: date
 *               due_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Invoice created
 */
router.post('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), createInvoice);

/**
 * @swagger
 * /api/invoices/{id}:
 *   get:
 *     summary: Get invoice by ID
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
 *         description: Invoice details
 */
router.get('/:id', authenticate, getInvoiceById);

/**
 * @swagger
 * /api/invoices/{id}:
 *   patch:
 *     summary: Update invoice (Admin/Procurement/Finance only)
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
 *         description: Invoice updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT', 'FINANCE'), updateInvoice);

/**
 * @swagger
 * /api/invoices/{id}/pay:
 *   patch:
 *     summary: Record invoice payment (Admin/Procurement/Finance only)
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
 *               paid_amount:
 *                 type: number
 *               payment_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Payment recorded
 */
router.patch('/:id/pay', authenticate, requireRoles('ADMIN', 'PROCUREMENT', 'FINANCE'), recordPayment);

/**
 * @swagger
 * /api/invoices/{id}:
 *   delete:
 *     summary: Delete invoice (Admin/Procurement only)
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
 *         description: Invoice deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), deleteInvoice);

module.exports = router;
