const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getBudgets,
  getBudgetById,
  createBudget,
  updateBudget,
  recordExpenditure,
  getBudgetSummary,
  deleteBudget,
} = require('../controllers/budgets.controller');

/**
 * @swagger
 * /api/budgets:
 *   get:
 *     summary: List budgets (Admin/Finance only)
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: department_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: fiscal_year
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, CLOSED]
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
 *         description: List of budgets
 */
router.get('/', authenticate, requireRoles('ADMIN', 'FINANCE'), getBudgets);

/**
 * @swagger
 * /api/budgets/summary:
 *   get:
 *     summary: Get budget summary (Admin/Finance only)
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Budget summary statistics
 */
router.get('/summary', authenticate, requireRoles('ADMIN', 'FINANCE'), getBudgetSummary);

/**
 * @swagger
 * /api/budgets:
 *   post:
 *     summary: Create budget (Admin/Finance only)
 *     tags: [Finance]
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
 *               fiscal_year:
 *                 type: integer
 *               category:
 *                 type: string
 *               allocated_amount:
 *                 type: number
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Budget created
 */
router.post('/', authenticate, requireRoles('ADMIN', 'FINANCE'), createBudget);

/**
 * @swagger
 * /api/budgets/{id}:
 *   get:
 *     summary: Get budget by ID
 *     tags: [Finance]
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
 *         description: Budget details
 */
router.get('/:id', authenticate, getBudgetById);

/**
 * @swagger
 * /api/budgets/{id}:
 *   patch:
 *     summary: Update budget (Admin/Finance only)
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
 *     responses:
 *       200:
 *         description: Budget updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN', 'FINANCE'), updateBudget);

/**
 * @swagger
 * /api/budgets/{id}/expenditure:
 *   post:
 *     summary: Record expenditure (Admin/Finance only)
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
 *               description:
 *                 type: string
 *               expenditure_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Expenditure recorded
 */
router.post('/:id/expenditure', authenticate, requireRoles('ADMIN', 'FINANCE'), recordExpenditure);

/**
 * @swagger
 * /api/budgets/{id}:
 *   delete:
 *     summary: Delete budget (Admin/Finance only)
 *     tags: [Finance]
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
 *         description: Budget deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN', 'FINANCE'), deleteBudget);

module.exports = router;
