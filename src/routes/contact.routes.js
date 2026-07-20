const express = require('express');
const router = express.Router();
const { sendContactEmail } = require('../controllers/contact.controller');

// POST /api/contact - Send contact form email
router.post('/', sendContactEmail);

module.exports = router;
