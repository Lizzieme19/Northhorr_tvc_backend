const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const c = require('../controllers/studentMerges.controller');

/**
 * @swagger
 * /api/student-merges:
 *   get:
 *     summary: Earlier merges (older admissions folded into a later one) and whether each can be restored (Admin)
 *     tags: [Student merges]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The merges
 */
router.get('/', authenticate, requireRoles('ADMIN'), c.list);

/**
 * @swagger
 * /api/student-merges/{id}/preview:
 *   get:
 *     summary: What restoring an earlier merge would do - the admission, the terms and payments that move, and the money (Admin). Changes nothing.
 *     tags: [Student merges]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string }, description: The merge (history entry) id }
 *       - { in: query, name: term_ids, schema: { type: string }, description: Comma separated terms that belong to the earlier admission (default - the terms at its level) }
 *       - { in: query, name: status, schema: { type: string }, description: Status of the restored admission (default GRADUATED) }
 *     responses:
 *       200:
 *         description: The plan
 */
router.get('/:id/preview', authenticate, requireRoles('ADMIN'), c.preview);

/**
 * @swagger
 * /api/student-merges/{id}/restore:
 *   post:
 *     summary: Put an earlier merged admission back as its own record, linked under the current one (Admin)
 *     tags: [Student merges]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Restored
 *       409:
 *         description: There are notes to confirm first
 */
router.post('/:id/restore', authenticate, requireRoles('ADMIN'), c.restore);

module.exports = router;
