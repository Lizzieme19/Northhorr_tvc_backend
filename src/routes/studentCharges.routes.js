const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const c = require('../controllers/studentCharges.controller');

const money = requireRoles('ADMIN', 'FINANCE');

/**
 * @swagger
 * /api/student-charges/sheet:
 *   get:
 *     summary: The students in a term with the amount set for each of them for one fee type (Admin/Finance)
 *     description: Query - fee_type_id, term_id (both required), search, course_id, level, department_id, student_type_id, only_set (true/false), page, limit.
 *     tags: [Student charges]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The students, and how many amounts are set for the term
 */
router.get('/sheet', authenticate, money, c.sheet);

/**
 * @swagger
 * /api/student-charges/save:
 *   post:
 *     summary: Set, change or remove the amount a fee type charges individual students for a term (Admin/Finance)
 *     description: Body - fee_type_id, term_id, entries [{student_id or admission_no, amount (null removes it), note}], apply. With apply false nothing is saved and the effect on the fees is returned.
 *     tags: [Student charges]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: What was or would be changed, rows that could not be used, and the effect on the fees
 */
router.post('/save', authenticate, money, c.save);

/**
 * @swagger
 * /api/student-charges/student/{id}:
 *   get:
 *     summary: Every amount set for one student (Admin/Finance)
 *     tags: [Student charges]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: The amounts
 */
router.get('/student/:id', authenticate, money, c.forStudent);

module.exports = router;
