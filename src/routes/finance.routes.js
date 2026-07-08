const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { requirePasswordChange } = require('../middleware/requirePasswordChange');
const {
  getFinanceStudents,
  markFeePaid,
  getFeeSummary,
} = require('../controllers/finance.controller');

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
 *               amount:
 *                 type: number
 *               status:
 *                 type: string
 *                 enum: [PAID, PARTIAL]
 *               payment_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Fee payment recorded
 */
router.patch('/students/:id/fees', authenticate, requireRoles('ADMIN', 'FINANCE'), markFeePaid);

module.exports = router;
