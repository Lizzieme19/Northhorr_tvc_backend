const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { requirePasswordChange } = require('../middleware/requirePasswordChange');
const {
  getFinanceStudents,
  markFeePaid,
  getFeeSummary,
  getStudentBalance,
} = require('../controllers/finance.controller');
const {
  getReportFilters,
  exportFeesReport,
  exportStudentsReport,
} = require('../controllers/reports.controller');

/**
 * @swagger
 * /api/finance/students:
 *   get:
 *     summary: List students with fee information (Admin/Finance only)
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PARTIAL, PAID, OVERDUE]
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
 *         description: List of students with fee information
 */
router.get('/students', authenticate, requireRoles('ADMIN', 'FINANCE'), getFinanceStudents);

/**
 * @swagger
 * /api/finance/summary:
 *   get:
 *     summary: Get fee summary statistics (Admin/Finance only)
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Fee summary statistics
 */
router.get('/summary', authenticate, requireRoles('ADMIN', 'FINANCE'), getFeeSummary);

/**
 * @swagger
 * /api/finance/students/{id}/fees:
 *   patch:
 *     summary: Mark student fees as paid (Admin/Finance only)
 *     tags: [Finance]
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
 *               fee_type_id:
 *                 type: string
 *               term_id:
 *                 type: string
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Fee payment recorded
 */
router.patch('/students/:id/fees', authenticate, requireRoles('ADMIN', 'FINANCE'), markFeePaid);

/**
 * @swagger
 * /api/finance/students/{id}/balance:
 *   get:
 *     summary: Get student fee balance (Admin/Finance only)
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: term_id
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student balance information
 */
router.get('/students/:id/balance', authenticate, requireRoles('ADMIN', 'FINANCE'), getStudentBalance);

/**
 * @swagger
 * /api/finance/reports/filters:
 *   get:
 *     summary: Dropdown values for the report filters (Admin/Finance only)
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Levels, years, intakes, departments, courses, terms and fee types
 */
router.get('/reports/filters', authenticate, requireRoles('ADMIN', 'FINANCE'), getReportFilters);

/**
 * @swagger
 * /api/finance/reports/fees/export:
 *   get:
 *     summary: Download the student fees report as Excel (Admin/Finance only)
 *     description: Sheets - Summary, Fee Balances, Payments, Paid by Fee Type
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: department_id, schema: { type: string } }
 *       - { in: query, name: course_id, schema: { type: string } }
 *       - { in: query, name: level, schema: { type: string } }
 *       - { in: query, name: intake, schema: { type: string, enum: [JANUARY, MAY, SEPTEMBER] } }
 *       - { in: query, name: year, schema: { type: integer } }
 *       - { in: query, name: status, description: Student status, schema: { type: string } }
 *       - { in: query, name: gender, schema: { type: string } }
 *       - { in: query, name: helb, schema: { type: string, enum: ['true', 'false'] } }
 *       - { in: query, name: term_id, schema: { type: string } }
 *       - { in: query, name: fee_status, schema: { type: string, enum: [PENDING, PARTIAL, PAID, OVERDUE] } }
 *       - { in: query, name: outstanding_only, schema: { type: string, enum: ['true'] } }
 *       - { in: query, name: fee_type_id, schema: { type: string } }
 *       - { in: query, name: date_from, description: Payments on/after (YYYY-MM-DD), schema: { type: string } }
 *       - { in: query, name: date_to, description: Payments on/before (YYYY-MM-DD), schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Excel workbook (.xlsx)
 */
router.get('/reports/fees/export', authenticate, requireRoles('ADMIN', 'FINANCE'), exportFeesReport);

/**
 * @swagger
 * /api/finance/reports/students/export:
 *   get:
 *     summary: Download the full student details report as Excel (Admin only)
 *     description: Sheets - Summary, Students. Accepts the same filters as the fees report (payment-only filters are ignored).
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Excel workbook (.xlsx)
 */
router.get('/reports/students/export', authenticate, requireRoles('ADMIN'), exportStudentsReport);

module.exports = router;
