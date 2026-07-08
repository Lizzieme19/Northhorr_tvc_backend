const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getRFQs,
  getRFQById,
  createRFQ,
  updateRFQ,
  submitQuotation,
  selectQuotation,
  deleteRFQ,
} = require('../controllers/rfqs.controller');

/**
 * @swagger
 * /api/rfqs:
 *   get:
 *     summary: List RFQs/Tenders (Admin/Procurement only)
 *     tags: [Procurement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, PUBLISHED, CLOSED, AWARDED]
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
 *         description: List of RFQs
 */
router.get('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), getRFQs);

/**
 * @swagger
 * /api/rfqs:
 *   post:
 *     summary: Create RFQ/Tender (Admin/Procurement only)
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
 *               requisition_id:
 *                 type: string
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               closing_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: RFQ created
 */
router.post('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), createRFQ);

/**
 * @swagger
 * /api/rfqs/{id}:
 *   get:
 *     summary: Get RFQ by ID
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
 *         description: RFQ details
 */
router.get('/:id', authenticate, getRFQById);

/**
 * @swagger
 * /api/rfqs/{id}:
 *   patch:
 *     summary: Update RFQ (Admin/Procurement only)
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
 *         description: RFQ updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), updateRFQ);

/**
 * @swagger
 * /api/rfqs/{id}/quotations:
 *   post:
 *     summary: Submit quotation for RFQ
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
 *               supplier_id:
 *                 type: string
 *               quoted_amount:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Quotation submitted
 */
router.post('/:id/quotations', authenticate, submitQuotation);

/**
 * @swagger
 * /api/rfqs/{id}/quotations/{quotationId}/select:
 *   patch:
 *     summary: Select winning quotation (Admin/Procurement only)
 *     tags: [Procurement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: quotationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Quotation selected
 */
router.patch('/:id/quotations/:quotationId/select', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), selectQuotation);

/**
 * @swagger
 * /api/rfqs/{id}:
 *   delete:
 *     summary: Delete RFQ (Admin/Procurement only)
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
 *         description: RFQ deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), deleteRFQ);

module.exports = router;
