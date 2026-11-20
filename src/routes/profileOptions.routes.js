const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { getOptions, createOption, addTypical, updateOption, deleteOption } = require('../controllers/profileOptions.controller');

/**
 * @swagger
 * /api/profile-options:
 *   get:
 *     summary: The interests and sports students can choose from (any signed-in user). Admin can add all=1 for every option with usage.
 *     tags: [Profile options]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Interests and sports
 *   post:
 *     summary: Add an interest or sport (Admin)
 *     tags: [Profile options]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Added
 */
router.get('/', authenticate, getOptions);
router.post('/', authenticate, requireRoles('ADMIN'), createOption);

/**
 * @swagger
 * /api/profile-options/defaults:
 *   post:
 *     summary: Add the usual interests and sports that are missing (Admin)
 *     tags: [Profile options]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: How many were added
 */
router.post('/defaults', authenticate, requireRoles('ADMIN'), addTypical);

/**
 * @swagger
 * /api/profile-options/{id}:
 *   patch:
 *     summary: Rename, switch on or off, or reorder an option (Admin)
 *     tags: [Profile options]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Saved
 *   delete:
 *     summary: Remove an option no student has chosen (Admin)
 *     tags: [Profile options]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Removed
 */
router.patch('/:id', authenticate, requireRoles('ADMIN'), updateOption);
router.delete('/:id', authenticate, requireRoles('ADMIN'), deleteOption);

module.exports = router;
