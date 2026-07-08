const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getLeaveRequests,
  getLeaveRequestById,
  getMyLeaveRequests,
  createLeaveRequest,
  approveLeaveRequest,
  cancelLeaveRequest,
  getLeaveBalance,
  getMyLeaveBalance,
} = require('../controllers/leaves.controller');

/**
 * @swagger
 * /api/leaves:
 *   get:
 *     summary: List leave requests (Admin/HR only)
 *     tags: [Staff Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED, CANCELLED]
 *       - in: query
 *         name: staff_id
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
 *         description: List of leave requests
 */
router.get('/', authenticate, requireRoles('ADMIN', 'HR'), getLeaveRequests);

/**
 * @swagger
 * /api/leaves/balance/{staff_id}:
 *   get:
 *     summary: Get leave balance for staff (Admin/HR only)
 *     tags: [Staff Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: staff_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Leave balance details
 */
router.get('/balance/:staff_id', authenticate, requireRoles('ADMIN', 'HR'), getLeaveBalance);

/**
 * @swagger
 * /api/leaves/me:
 *   get:
 *     summary: Get current staff's leave requests
 *     tags: [Staff Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of leave requests
 */
router.get('/me', authenticate, requireRoles('STAFF'), getMyLeaveRequests);

/**
 * @swagger
 * /api/leaves/balance:
 *   get:
 *     summary: Get current staff's leave balance
 *     tags: [Staff Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Leave balance details
 */
router.get('/balance', authenticate, requireRoles('STAFF'), getMyLeaveBalance);

/**
 * @swagger
 * /api/leaves:
 *   post:
 *     summary: Create leave request
 *     tags: [Staff Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               leave_type:
 *                 type: string
 *               start_date:
 *                 type: string
 *                 format: date
 *               end_date:
 *                 type: string
 *                 format: date
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: Leave request created
 */
router.post('/', authenticate, requireRoles('STAFF'), createLeaveRequest);

/**
 * @swagger
 * /api/leaves/{id}/cancel:
 *   patch:
 *     summary: Cancel leave request
 *     tags: [Staff Management]
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
 *         description: Leave request cancelled
 */
router.patch('/:id/cancel', authenticate, requireRoles('STAFF'), cancelLeaveRequest);

/**
 * @swagger
 * /api/leaves/{id}:
 *   get:
 *     summary: Get leave request by ID (Admin/HR only)
 *     tags: [Staff Management]
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
 *         description: Leave request details
 */
router.get('/:id', authenticate, requireRoles('ADMIN', 'HR'), getLeaveRequestById);

/**
 * @swagger
 * /api/leaves/{id}/approve:
 *   patch:
 *     summary: Approve leave request (Admin/HR only)
 *     tags: [Staff Management]
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
 *               status:
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Leave request approved/rejected
 */
router.patch('/:id/approve', authenticate, requireRoles('ADMIN', 'HR'), approveLeaveRequest);

module.exports = router;
