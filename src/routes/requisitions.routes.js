const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getRequisitions,
  getRequisitionById,
  createRequisition,
  updateRequisition,
  submitRequisition,
  approveRequisition,
  deleteRequisition,
} = require('../controllers/requisitions.controller');

/**
 * @swagger
 * /api/requisitions:
 *   get:
 *     summary: List purchase requisitions (Admin/Procurement only)
 *     tags: [Procurement]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, PENDING, APPROVED, REJECTED]
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
 *         description: List of requisitions
 */
router.get('/', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), getRequisitions);

/**
 * @swagger
 * /api/requisitions:
 *   post:
 *     summary: Create purchase requisition
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
 *               department_id:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       201:
 *         description: Requisition created
 */
router.post('/', authenticate, createRequisition);

/**
 * @swagger
 * /api/requisitions/{id}:
 *   get:
 *     summary: Get requisition by ID
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
 *         description: Requisition details
 */
router.get('/:id', authenticate, getRequisitionById);

/**
 * @swagger
 * /api/requisitions/{id}:
 *   patch:
 *     summary: Update requisition
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
 *         description: Requisition updated
 */
router.patch('/:id', authenticate, updateRequisition);

/**
 * @swagger
 * /api/requisitions/{id}/submit:
 *   patch:
 *     summary: Submit requisition for approval
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
 *         description: Requisition submitted
 */
router.patch('/:id/submit', authenticate, submitRequisition);

/**
 * @swagger
 * /api/requisitions/{id}/approve:
 *   patch:
 *     summary: Approve requisition (Admin/Procurement only)
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
 *         description: Requisition approved
 */
router.patch('/:id/approve', authenticate, requireRoles('ADMIN', 'PROCUREMENT'), approveRequisition);

/**
 * @swagger
 * /api/requisitions/{id}:
 *   delete:
 *     summary: Delete requisition
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
 *         description: Requisition deleted
 */
router.delete('/:id', authenticate, deleteRequisition);

module.exports = router;
