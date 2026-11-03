const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { spreadsheetUpload } = require('../middleware/upload');
const {
  getToTag, registerReceived, getAssets, getAssetSummary, getAssetOptions, getTagOptions, getAssetById, createAsset, updateAsset,
  calculateDepreciation, recordMaintenance, disposeAsset, deleteAsset,
  getLocations, createLocation, renameLocation, mergeLocation, deleteLocation,
} = require('../controllers/assets.controller');
const { previewAssetImport, importAssets } = require('../controllers/assetImport.controller');

// The asset register is managed by Procurement and Admin
const manage = [authenticate, requireRoles('ADMIN', 'PROCUREMENT')];

/**
 * @swagger
 * /api/assets:
 *   get:
 *     summary: List the asset register with filters (Admin/Procurement)
 *     description: Query asset_class, category, location_id ('none' for no location), condition, status, department_id, needs_valuation, attention, search, page, limit.
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Assets with a worked-out valuation, and pagination
 */
router.get('/', ...manage, getAssets);

/**
 * @swagger
 * /api/assets/summary:
 *   get:
 *     summary: Counts by asset class, condition and status, plus what needs valuation or attention (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Register summary
 */
router.get('/summary', ...manage, getAssetSummary);

/**
 * @swagger
 * /api/assets/options:
 *   get:
 *     summary: Asset classes, item types, locations and conditions for filters and forms (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Options
 */
router.get('/options', ...manage, getAssetOptions);

/**
 * @swagger
 * /api/assets/tag-options:
 *   get:
 *     summary: The tag numbering in use for an item type and the next number (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: asset_class, required: true, schema: { type: string } }
 *       - { in: query, name: category, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Tag prefixes with the next tag number for each
 */
router.get('/tag-options', ...manage, getTagOptions);

/**
 * @swagger
 * /api/assets/to-tag:
 *   get:
 *     summary: Asset lines on verified GRNs that still need tagging (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lines with how many are left to tag, and the tag numbering that would be used
 */
router.get('/to-tag', ...manage, getToTag);

/**
 * @swagger
 * /api/assets/to-tag/{itemId}:
 *   post:
 *     summary: Tag items received on a verified GRN line - creates the asset records (Admin/Procurement)
 *     description: Send count, or units with a serial number, location and condition for each. Cost, dates and the GRN, LPO and supplier are filled in from the purchase.
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: itemId, required: true, schema: { type: string } }
 *     responses:
 *       201:
 *         description: Assets created
 */
router.post('/to-tag/:itemId', ...manage, registerReceived);

/**
 * @swagger
 * /api/assets/locations:
 *   get:
 *     summary: Locations where assets are kept, with how many assets are in each (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Locations
 *   post:
 *     summary: Add a location (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Created
 */
router.get('/locations', ...manage, getLocations);
router.post('/locations', ...manage, createLocation);

/**
 * @swagger
 * /api/assets/locations/{id}:
 *   patch:
 *     summary: Rename a location (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Renamed
 *   delete:
 *     summary: Remove a location nothing is kept in (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Removed
 */
router.patch('/locations/:id', ...manage, renameLocation);
router.delete('/locations/:id', ...manage, deleteLocation);

/**
 * @swagger
 * /api/assets/locations/{id}/merge:
 *   post:
 *     summary: Merge two spellings of the same place - everything moves to into_id (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               into_id: { type: string }
 *     responses:
 *       200:
 *         description: Merged
 */
router.post('/locations/:id/merge', ...manage, mergeLocation);

/**
 * @swagger
 * /api/assets/import/preview:
 *   post:
 *     summary: Check the asset registers workbook and report what an import would do (Admin/Procurement). Creates nothing.
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Summary, locations, and the rows that need a look
 */
router.post('/import/preview', ...manage, spreadsheetUpload.single('file'), previewAssetImport);

/**
 * @swagger
 * /api/assets/import:
 *   post:
 *     summary: Import the asset registers workbook (Admin/Procurement). Items already in the register are skipped.
 *     description: Tagged items go to the asset register and the stock sheet goes to Inventory.
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *               include_stock: { type: string, description: "'false' to skip the stock sheet" }
 *     responses:
 *       200:
 *         description: What was created
 */
router.post('/import', ...manage, spreadsheetUpload.single('file'), importAssets);

/**
 * @swagger
 * /api/assets:
 *   post:
 *     summary: Register an asset, or several of the same item with quantity (Admin/Procurement)
 *     description: Tag numbers continue the numbering already used for the item type unless asset_code is given. Cost and dates are optional.
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Registered
 */
router.post('/', ...manage, createAsset);

/**
 * @swagger
 * /api/assets/{id}:
 *   get:
 *     summary: One asset with its locations, maintenance history and valuation (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Asset
 *   patch:
 *     summary: Update an asset (Admin/Procurement). resolve_attention true clears the "needs attention" flag.
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Updated
 *   delete:
 *     summary: Delete an asset (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Deleted
 */
router.get('/:id', ...manage, getAssetById);
router.patch('/:id', ...manage, updateAsset);
router.delete('/:id', ...manage, deleteAsset);

/**
 * @swagger
 * /api/assets/{id}/depreciate:
 *   post:
 *     summary: What the asset is worth now, worked out from cost, date and rate (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Asset with its valuation
 */
router.post('/:id/depreciate', ...manage, calculateDepreciation);

/**
 * @swagger
 * /api/assets/{id}/maintenance:
 *   post:
 *     summary: Record maintenance on an asset (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       201:
 *         description: Recorded
 */
router.post('/:id/maintenance', ...manage, recordMaintenance);

/**
 * @swagger
 * /api/assets/{id}/dispose:
 *   patch:
 *     summary: Dispose of or write off an asset, with a reason (Admin/Procurement)
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Disposed
 */
router.patch('/:id/dispose', ...manage, disposeAsset);

module.exports = router;
