const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const c = require('../controllers/studentTypes.controller');

const money = requireRoles('ADMIN', 'FINANCE');

/**
 * @swagger
 * /api/student-types:
 *   get:
 *     summary: The kinds of student (Direct, KUCCPS...) with how many students each has (Admin/Finance/Registrar)
 *     tags: [Student types]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Student types
 *   post:
 *     summary: Add a student type (Admin/Finance)
 *     tags: [Student types]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Added
 */
router.get('/', authenticate, requireRoles('ADMIN', 'FINANCE', 'REGISTRAR'), c.getTypes);
router.post('/', authenticate, money, c.createType);

/**
 * @swagger
 * /api/student-types/setup:
 *   post:
 *     summary: Make Direct and KUCCPS and give each student the one matching how they applied. apply=false only reports. (Admin/Finance)
 *     tags: [Student types]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: What was or would be done
 */
router.post('/setup', authenticate, money, c.setupFromApplications);

/**
 * @swagger
 * /api/student-types/fees:
 *   get:
 *     summary: The term fee per student type per term, and the fee types with their rules (Admin/Finance)
 *     tags: [Student types]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The grid
 */
router.get('/fees', authenticate, money, c.getFees);

/**
 * @swagger
 * /api/student-types/term-fees:
 *   put:
 *     summary: Set a student type's term fee for a term. apply=false reports who would change and by how much. (Admin/Finance)
 *     tags: [Student types]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Impact, and whether it was applied
 */
router.put('/term-fees', authenticate, money, c.setTermFee);

/**
 * @swagger
 * /api/student-types/fee-type-rules:
 *   put:
 *     summary: Limit a fee type to certain student types, with an amount per type. apply=false reports the effect. (Admin/Finance)
 *     tags: [Student types]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Impact, and whether it was applied
 */
router.put('/fee-type-rules', authenticate, money, c.setFeeTypeRules);

/**
 * @swagger
 * /api/student-types/assign:
 *   post:
 *     summary: Move students to a student type from a term onward. apply=false reports the effect. (Admin/Finance/Registrar)
 *     tags: [Student types]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Impact, and whether it was applied
 */
router.post('/assign', authenticate, requireRoles('ADMIN', 'FINANCE', 'REGISTRAR'), c.assign);

/**
 * @swagger
 * /api/student-types/{id}:
 *   patch:
 *     summary: Rename, describe, or switch a student type on or off (Admin/Finance)
 *     tags: [Student types]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Saved
 *   delete:
 *     summary: Remove a student type nothing uses (Admin/Finance)
 *     tags: [Student types]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Removed
 */
router.patch('/:id', authenticate, money, c.updateType);
router.delete('/:id', authenticate, money, c.deleteType);

/**
 * @swagger
 * /api/student-types/{id}/default:
 *   post:
 *     summary: Make a student type the default (Admin/Finance)
 *     tags: [Student types]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Done
 */
router.post('/:id/default', authenticate, money, c.makeDefault);

module.exports = router;
