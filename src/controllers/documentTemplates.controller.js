const prisma = require('../config/db');
const { uploadToS3 } = require('../middleware/upload');

// GET /api/document-templates
const getTemplates = async (req, res) => {
  try {
    const templates = await prisma.documentTemplate.findMany();
    res.json(templates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch document templates' });
  }
};

// GET /api/document-templates/:type
const getTemplateByType = async (req, res) => {
  try {
    const type = req.params.type.toUpperCase();
    const template = await prisma.documentTemplate.findUnique({
      where: { document_type: type },
    });

    // If it doesn't exist, we just return empty so the frontend can populate defaults
    res.json(template || { document_type: type, text_blocks: {} });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
};

// PATCH /api/document-templates/:type
const updateTemplate = async (req, res) => {
  try {
    const type = req.params.type.toUpperCase();
    const { text_blocks } = req.body;
    let ministry_logo_url = req.body.ministry_logo_url;
    let college_logo_url = req.body.college_logo_url;

    // Handle uploaded files if any
    if (req.files) {
      if (req.files.ministry_logo && req.files.ministry_logo.length > 0) {
        const file = req.files.ministry_logo[0];
        const uploadResult = await uploadToS3(file.buffer, file.originalname, 'logos');
        ministry_logo_url = uploadResult.url;
      }
      if (req.files.college_logo && req.files.college_logo.length > 0) {
        const file = req.files.college_logo[0];
        const uploadResult = await uploadToS3(file.buffer, file.originalname, 'logos');
        college_logo_url = uploadResult.url;
      }
    }

    // Parse JSON string if sent via FormData
    let parsedTextBlocks = undefined;
    if (text_blocks) {
      parsedTextBlocks = typeof text_blocks === 'string' ? JSON.parse(text_blocks) : text_blocks;
    }

    const template = await prisma.documentTemplate.upsert({
      where: { document_type: type },
      update: {
        ...(ministry_logo_url && { ministry_logo_url }),
        ...(college_logo_url && { college_logo_url }),
        ...(parsedTextBlocks !== undefined && { text_blocks: parsedTextBlocks }),
      },
      create: {
        document_type: type,
        ministry_logo_url,
        college_logo_url,
        text_blocks: parsedTextBlocks || {},
      },
    });

    res.json(template);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update template' });
  }
};

module.exports = {
  getTemplates,
  getTemplateByType,
  updateTemplate,
};
