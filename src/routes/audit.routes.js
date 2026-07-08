const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getAuditTrail,
  getAuditEntryById,
  getAuditStats,
} = require('../controllers/audit.controller');

/**
 * @swagger
 * /api/audit:
 *   get:
 *     summary: List audit trail (Admin only)
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *       - in: query
 *         name: entity_type
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
 *         description: List of audit entries
 */
router.get('/', authenticate, requireRoles('ADMIN'), getAuditTrail);

/**
 * @swagger
 * /api/audit/stats:
 *   get:
 *     summary: Get audit statistics (Admin only)
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Audit statistics
 */
router.get('/stats', authenticate, requireRoles('ADMIN'), getAuditStats);

/**
 * @swagger
 * /api/audit/{id}:
 *   get:
 *     summary: Get audit entry by ID
 *     tags: [Audit]
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
 *         description: Audit entry details
 */
router.get('/:id', authenticate, getAuditEntryById);

module.exports = router;
