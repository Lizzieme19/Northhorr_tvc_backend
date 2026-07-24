const express = require('express');
const router = express.Router();
const {
  enrollStudentInTerm,
  recordFeePayment,
  bulkRecordFeePayment,
  getStudentFeeSummary,
  promoteStudent,
  getStudentProgression,
  studentSelfEnroll,
  getStudentEnrollments,
  getBillingDashboard,
  getBillingReport,
} = require('../controllers/fee.controller');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');

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
router.get('/students/:studentId/summary', authenticate, getStudentFeeSummary);

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
router.post('/students/:studentId/promote', authenticate, requireRoles('ADMIN', 'DEPT_HEAD'), promoteStudent);

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

module.exports = router;
