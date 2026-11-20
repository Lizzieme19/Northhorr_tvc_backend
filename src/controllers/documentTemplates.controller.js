const prisma = require('../config/db');
const { uploadToS3 } = require('../middleware/upload');
const docs = require('../services/documentService');

const BLOCK_KEY = /^[A-Za-z0-9_]{1,40}$/;
// What may be saved in a template's text blocks: plain text per key (including _title and extra_1 ... extra_5)
const cleanBlocks = (blocks) => {
  const out = {};
  for (const [k, v] of Object.entries(blocks || {})) {
    if (!BLOCK_KEY.test(k) || v === null || v === undefined) continue;
    out[k] = String(v).slice(0, 6000);
  }
  return out;
};

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
    const existing = await prisma.documentTemplate.findUnique({ where: { document_type: type } });
    const previous = existing?.text_blocks || {};

    // Handle uploaded files if any
    let signature_url;
    let stamp_url;
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
      if (req.files.signature && req.files.signature.length > 0) {
        const file = req.files.signature[0];
        signature_url = (await uploadToS3(file.buffer, file.originalname, 'logos')).url;
      }
      if (req.files.stamp && req.files.stamp.length > 0) {
        const file = req.files.stamp[0];
        stamp_url = (await uploadToS3(file.buffer, file.originalname, 'logos')).url;
      }
    }

    // Parse JSON string if sent via FormData
    let parsedTextBlocks = undefined;
    if (text_blocks) {
      try {
        parsedTextBlocks = cleanBlocks(typeof text_blocks === 'string' ? JSON.parse(text_blocks) : text_blocks);
      } catch (e) {
        return res.status(400).json({ error: 'The text could not be read' });
      }
      // the signature and stamp images are kept unless a new one is uploaded or removal is asked for
      const keep = (key, uploaded, remove) => {
        const url = remove ? undefined : (uploaded || parsedTextBlocks[key] || previous[key]);
        if (url) parsedTextBlocks[key] = url; else delete parsedTextBlocks[key];
      };
      keep('_signature_url', signature_url, req.body.remove_signature === 'true');
      keep('_stamp_url', stamp_url, req.body.remove_stamp === 'true');
    } else if (signature_url || stamp_url) {
      parsedTextBlocks = { ...previous, ...(signature_url && { _signature_url: signature_url }), ...(stamp_url && { _stamp_url: stamp_url }) };
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

// GET /api/document-templates/style - the letterhead, footer, colour and typeface shared by every document
const getStyle = async (req, res) => {
  try {
    res.json({ style: await docs.loadStyle(), defaults: docs.DEFAULT_STYLE });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load the letterhead' });
  }
};

// PATCH /api/document-templates/style
const updateStyle = async (req, res) => {
  try {
    const clean = docs.cleanStyle(req.body || {});
    if (Object.keys(clean).length === 0) return res.status(400).json({ error: 'Nothing to save' });
    const current = await docs.loadStyle();
    const saved = { ...current, ...clean };
    await prisma.systemSetting.upsert({
      where: { key: 'document_style' },
      update: { value: JSON.stringify(saved) },
      create: { key: 'document_style', value: JSON.stringify(saved) },
    });
    res.json({ style: saved, message: 'Letterhead saved. It applies to every document from now on.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save the letterhead' });
  }
};

// POST /api/document-templates/:type/preview  { text_blocks, style }
// A PDF made with the edits that are on screen (not yet saved), using the latest real record as the example.
const previewTemplate = async (req, res) => {
  try {
    const type = req.params.type.toUpperCase();
    const saved = await prisma.documentTemplate.findUnique({ where: { document_type: type } });
    const template = {
      document_type: type,
      ministry_logo_url: saved?.ministry_logo_url || null,
      college_logo_url: saved?.college_logo_url || null,
      text_blocks: { ...cleanBlocks(req.body?.text_blocks), ...(saved?.text_blocks?._signature_url && { _signature_url: saved.text_blocks._signature_url }), ...(saved?.text_blocks?._stamp_url && { _stamp_url: saved.text_blocks._stamp_url }) },
    };
    const run = (fn) => docs.overrides.run({ template, style: req.body?.style }, fn);

    const studentTypes = { ADMISSION_LETTER: 'generateAdmissionLetter', ACCEPTANCE_LETTER: 'generateLetterOfAcceptance', TRAINING_ADMISSION: 'generateAdmissionForTraining', PERSONAL_INFO: 'generateStudentPersonalInfo' };
    let pdf;
    if (studentTypes[type]) {
      const student = await prisma.student.findFirst({ orderBy: { created_at: 'desc' }, include: { application: true, course: true, department: true } });
      if (!student) return res.status(404).json({ error: 'Add a student first. The preview uses the latest student as its example.' });
      const feeTypes = type === 'ADMISSION_LETTER' ? await prisma.feeType.findMany({ where: { is_active: true } }) : undefined;
      pdf = await run(() => docs[studentTypes[type]](student, feeTypes));
    } else {
      const loaders = {
        LPO: [() => prisma.lPO.findFirst({ orderBy: { created_at: 'desc' }, include: { supplier: true, department: true, items: true } }), 'generateLPO', 'LPO'],
        RFQ: [() => prisma.rFQ.findFirst({ orderBy: { created_at: 'desc' }, include: { requisition: { include: { department: { select: { name: true } }, requester: { select: { email: true } }, items: true } }, supplier: true, quotations: { include: { supplier: true } }, lpos: true } }), 'generateRFQ', 'RFQ'],
        GRN: [() => prisma.gRN.findFirst({ orderBy: { created_at: 'desc' }, include: { lpo: { include: { supplier: true, department: true } }, items: true } }), 'generateGRN', 'GRN'],
        SUPPLIER_INVOICE: [() => prisma.supplierInvoice.findFirst({ orderBy: { created_at: 'desc' }, include: { lpo: { include: { supplier: true, department: true } }, supplier: true } }), 'generateSupplierInvoice', 'invoice'],
      };
      const entry = loaders[type];
      if (!entry) return res.status(400).json({ error: 'This document cannot be previewed' });
      const record = await entry[0]();
      if (!record) return res.status(404).json({ error: `There is no ${entry[2]} yet. The preview uses the latest one as its example.` });
      pdf = await run(() => docs[entry[1]](record));
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error('Template preview error:', err);
    res.status(500).json({ error: 'Could not make the preview' });
  }
};

module.exports = {
  getTemplates,
  getTemplateByType,
  updateTemplate,
  getStyle,
  updateStyle,
  previewTemplate,
};
