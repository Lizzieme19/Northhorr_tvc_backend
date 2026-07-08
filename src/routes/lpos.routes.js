const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getLPOs,
  getLPOById,
  createLPO,
  approveLPO,
  issueLPO,
  generateLPOPDF,
  deleteLPO,
} = require('../controllers/lpos.controller');

/**
 * @swagger
 * /api/lpos:
 *   get:
 *     summary: List LPOs (Admin/Procurement only)
 *     tags: [Procurement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, PENDING, APPROVED, ISSUED, CANCELLED]
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
 *         description: List of LPOs
 */
router.get('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), getLPOs);

/**
 * @swagger
 * /api/lpos:
 *   post:
 *     summary: Create LPO (Admin/Procurement only)
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
 *               rfq_id:
 *                 type: string
 *               supplier_id:
 *                 type: string
 *               department_id:
 *                 type: string
 *     responses:
 *       201:
 *         description: LPO created
 */
router.post('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), createLPO);

/**
 * @swagger
 * /api/lpos/{id}:
 *   get:
 *     summary: Get LPO by ID
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
 *         description: LPO details
 */
router.get('/:id', authenticate, getLPOById);

/**
 * @swagger
 * /api/lpos/{id}/pdf:
 *   get:
 *     summary: Generate LPO PDF
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
 *         description: PDF generated
 *       404:
 *         description: LPO not found
 */
router.get('/:id/pdf', authenticate, generateLPOPDF);

/**
 * @swagger
 * /api/lpos/{id}/approve:
 *   patch:
 *     summary: Approve LPO (Admin/Procurement only)
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
 *         description: LPO approved
 */
router.patch('/:id/approve', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), approveLPO);

/**
 * @swagger
 * /api/lpos/{id}/issue:
 *   patch:
 *     summary: Issue LPO to supplier (Admin/Procurement only)
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
 *         description: LPO issued
 */
router.patch('/:id/issue', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), issueLPO);

/**
 * @swagger
 * /api/lpos/{id}:
 *   delete:
 *     summary: Delete LPO (Admin/Procurement only)
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
 *         description: LPO deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), deleteLPO);

module.exports = router;
