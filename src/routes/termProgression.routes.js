const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles, denyRoles } = require('../middleware/roles');
const {
  admitStudentToTerm,
  getStudentHistory,
  getStudentProgression,
  getStudentBalances,
  updateProgressionNotes,
  getAllProgressions,
} = require('../controllers/termProgression.controller');

/**
 * @swagger
 * /api/term-progression/admit:
 *   post:
 *     summary: Admit student to new term with fee carry-over (Admin only)
 *     tags: [Term Progression]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - student_id
 *               - new_term_id
 *             properties:
 *               student_id:
 *                 type: string
 *               new_term_id:
 *                 type: string
 *               new_level:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Student admitted successfully
 *       400:
 *         description: Invalid input
 */
router.post('/admit', authenticate, requireRoles('ADMIN', 'REGISTRAR'), admitStudentToTerm);

/**
 * @swagger
 * /api/term-progression/{student_id}:
 *   get:
 *     summary: Get student's term progression history
 *     tags: [Term Progression]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: student_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Progression history
 */
// IMPORTANT: /admin/all must be defined BEFORE /:student_id to avoid routing conflict
router.get('/admin/all', authenticate, requireRoles('ADMIN', 'REGISTRAR'), getAllProgressions);

router.get('/:student_id', authenticate, getStudentProgression);

/**
 * @swagger
 * /api/term-progression/{student_id}/balances:
 *   get:
 *     summary: Get student's term balances with carry-over info
 *     tags: [Term Progression]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: student_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Term balances
 */
router.get('/:student_id/balances', authenticate, denyRoles('REGISTRAR'), getStudentBalances);

/**
 * @swagger
 * /api/term-progression/{student_id}/history:
 *   get:
 *     summary: Full academic history of a student - every level with its admission number, intake, year and dates
 *     tags: [Term Progression]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: student_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student summary and the list of stages (a student may only read their own)
 */
router.get('/:student_id/history', authenticate, requireRoles('ADMIN', 'REGISTRAR', 'FINANCE', 'DEPT_HEAD', 'STUDENT'), getStudentHistory);

/**
 * @swagger
 * /api/term-progression/{id}/notes:
 *   patch:
 *     summary: Update progression notes (Admin only)
 *     tags: [Term Progression]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Progression updated
 */
router.patch('/:id/notes', authenticate, requireRoles('ADMIN', 'REGISTRAR'), updateProgressionNotes);

module.exports = router;
