const express = require('express');
const router = express.Router();
const {
  enrollStudentInTerm,
  recordFeePayment,
  allocatePayment,
  getAllocationBreakdown,
  bulkRecordFeePayment,
  getStudentFeeSummary,
  promoteStudent,
  getStudentProgression,
  studentSelfEnroll,
  getStudentEnrollments,
  getBillingDashboard,
  getBillingReport,
} = require('../controllers/fee.controller');
const {
  editPayment,
  voidPayment,
  setTermFeeOverride,
  getFeeHistory,
  reconcile,
} = require('../controllers/feeCorrections.controller');
const { authenticate } = require('../middleware/auth');
const { requireRoles, denyRoles } = require('../middleware/roles');

/**
 * @swagger
 * /api/fees/students/{studentId}/terms/{termId}/enroll:
 *   post:
 *     summary: Enroll student in a term with fee calculation
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: termId
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
 *               allowPartialPayment:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Student enrolled successfully
 */
router.post('/students/:studentId/terms/:termId/enroll', authenticate, requireRoles('ADMIN', 'FINANCE'), enrollStudentInTerm);

/**
 * @swagger
 * /api/fees/students/{studentId}/terms/{termId}/payment:
 *   post:
 *     summary: Record fee payment for a student
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: termId
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
 *               amount:
 *                 type: number
 *               fee_type_id:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment recorded successfully
 */
router.post('/students/:studentId/terms/:termId/payment', authenticate, requireRoles('ADMIN', 'FINANCE'), recordFeePayment);

// POST /api/fees/students/:studentId/terms/:termId/allocate - Finance Officer allocates unallocated payment to fee types
router.post('/students/:studentId/terms/:termId/allocate', authenticate, requireRoles('ADMIN', 'FINANCE'), allocatePayment);

// GET /api/fees/students/:studentId/terms/:termId/allocations - Get allocation breakdown for a term
router.get('/students/:studentId/terms/:termId/allocations', authenticate, requireRoles('ADMIN', 'FINANCE'), getAllocationBreakdown);

/**
 * @swagger
 * /api/fees/bulk-record-payment:
 *   post:
 *     summary: Bulk record fee payments for multiple students (Admin/Finance only)
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               payments:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     studentId:
 *                       type: string
 *                     termId:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     fee_type_id:
 *                       type: string
 *                     notes:
 *                       type: string
 *     responses:
 *       200:
 *         description: Bulk payments recorded successfully
 */
router.post('/bulk-record-payment', authenticate, requireRoles('ADMIN', 'FINANCE'), bulkRecordFeePayment);

/**
 * @swagger
 * /api/fees/students/{studentId}/summary:
 *   get:
 *     summary: Get student fee summary
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Fee summary retrieved
 */
router.get('/students/:studentId/summary', authenticate, denyRoles('REGISTRAR'), getStudentFeeSummary);

/**
 * @swagger
 * /api/fees/students/{studentId}/promote:
 *   post:
 *     summary: Promote student to next level
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
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
 *               toLevel:
 *                 type: string
 *               termId:
 *                 type: string
 *               notes:
 *                 type: string
 *               forcePromote:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Student promoted successfully
 */
router.post('/students/:studentId/promote', authenticate, requireRoles('ADMIN', 'DEPT_HEAD', 'REGISTRAR'), promoteStudent);

/**
 * @swagger
 * /api/fees/students/{studentId}/progression:
 *   get:
 *     summary: Get student progression history
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Progression history retrieved
 */
router.get('/students/:studentId/progression', authenticate, getStudentProgression);

/**
 * @swagger
 * /api/fees/terms/{termId}/enroll:
 *   post:
 *     summary: Student self-enrollment in a term
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student enrolled successfully
 */
router.post('/terms/:termId/enroll', authenticate, requireRoles('STUDENT'), studentSelfEnroll);

/**
 * @swagger
 * /api/fees/students/me/enrollments:
 *   get:
 *     summary: Get student's own enrollments
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Student enrollments retrieved
 */
router.get('/students/me/enrollments', authenticate, requireRoles('STUDENT'), getStudentEnrollments);

/**
 * @swagger
 * /api/fees/billing/dashboard:
 *   get:
 *     summary: Get billing dashboard data (Finance only)
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: termId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
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
 *         description: Billing dashboard data
 */
router.get('/billing/dashboard', authenticate, requireRoles('ADMIN', 'FINANCE'), getBillingDashboard);

/**
 * @swagger
 * /api/fees/billing/report/{termId}:
 *   get:
 *     summary: Get billing report by term (Finance only)
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Billing report
 */
router.get('/billing/report/:termId', authenticate, requireRoles('ADMIN', 'FINANCE'), getBillingReport);

/**
 * @swagger
 * /api/fees/records/{id}:
 *   patch:
 *     summary: Correct a payment - amount, date, notes, fee type or term (Admin/Finance). A reason is required and the change is logged.
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Updated payment and recalculated term balances
 */
router.patch('/records/:id', authenticate, requireRoles('ADMIN', 'FINANCE'), editPayment);

/**
 * @swagger
 * /api/fees/records/{id}/void:
 *   post:
 *     summary: Void a wrongly recorded payment (Admin/Finance). A reason is required; the payment is kept in the audit trail.
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Payment voided and balances recalculated
 */
router.post('/records/:id/void', authenticate, requireRoles('ADMIN', 'FINANCE'), voidPayment);

/**
 * @swagger
 * /api/fees/students/{studentId}/terms/{termId}/fee:
 *   patch:
 *     summary: Set one student's fee for one term, or clear it with total_fees null (Admin/Finance)
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string } }
 *       - { in: path, name: termId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Recalculated term balances
 */
router.patch('/students/:studentId/terms/:termId/fee', authenticate, requireRoles('ADMIN', 'FINANCE'), setTermFeeOverride);

/**
 * @swagger
 * /api/fees/students/{studentId}/history:
 *   get:
 *     summary: Log of corrections made to a student's fees (Admin/Finance)
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Corrections, newest first
 */
router.get('/students/:studentId/history', authenticate, requireRoles('ADMIN', 'FINANCE'), getFeeHistory);

/**
 * @swagger
 * /api/fees/reconcile:
 *   post:
 *     summary: Check balances against payments and fee settings, and optionally fix them (Admin/Finance; bulk apply is Admin only)
 *     tags: [Fees]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               student_id: { type: string }
 *               term_id: { type: string }
 *               apply: { type: boolean }
 *     responses:
 *       200:
 *         description: What was (or would be) changed
 */
router.post('/reconcile', authenticate, requireRoles('ADMIN', 'FINANCE'), reconcile);

module.exports = router;
