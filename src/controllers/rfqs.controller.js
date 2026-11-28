const prisma = require('../config/db');
const { generateRFQ } = require('../services/documentService');
const { rfqItems } = require('../utils/rfqItems');

// Generate RFQ number
const generateRFQNo = () => {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RFQ/${year}/${rand}`;
};

// GET /api/rfqs - List RFQs
const getRFQs = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;

    const [rfqs, total] = await Promise.all([
      prisma.rFQ.findMany({
        where,
        include: {
          requisition: {
            include: {
              department: { select: { name: true } },
              items: true,
            },
          },
          supplier: { select: { id: true, name: true, email: true } },
          quotations: {
            include: { supplier: { select: { name: true } } },
          },
          lpos: true,
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.rFQ.count({ where }),
    ]);

    res.json({
      rfqs: rfqs.map((r) => ({ ...r, items: rfqItems(r) })),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/rfqs/:id - Get RFQ by ID
const getRFQById = async (req, res) => {
  try {
    const rfq = await prisma.rFQ.findUnique({
      where: { id: req.params.id },
      include: {
        requisition: {
          include: {
            department: { select: { name: true } },
            requester: { select: { email: true } },
            items: true,
          },
        },
        supplier: true,
        quotations: {
          include: { supplier: true },
        },
        lpos: true,
      },
    });

    if (!rfq) return res.status(404).json({ error: 'RFQ not found' });

    res.json({ ...rfq, items: rfqItems(rfq) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Checks a set of RFQs for one requisition and creates them together: either all are made or none.
// Each: { title, description?, item_ids?: [] (empty = every line), supplier_ids?: [] }
const makeRFQs = async ({ requisition_id, opening_date, closing_date, list }) => {
  if (!requisition_id) throw fail('Choose the requisition');
  if (!opening_date || !closing_date) throw fail('Opening date and closing date are required');
  const opens = new Date(opening_date);
  const closes = new Date(closing_date);
  if (isNaN(opens.getTime()) || isNaN(closes.getTime())) throw fail('Give real opening and closing dates');
  if (closes < opens) throw fail('The closing date cannot be before the opening date');
  if (!Array.isArray(list) || !list.length) throw fail('Add at least one RFQ');
  if (list.length > 20) throw fail('Create at most 20 RFQs at a time');

  const requisition = await prisma.purchaseRequisition.findUnique({ where: { id: requisition_id }, include: { items: true } });
  if (!requisition) throw fail('Requisition not found', 404);
  if (!['APPROVED', 'ORDERED'].includes(requisition.status)) throw fail('The requisition must be approved first');
  const lines = new Map(requisition.items.map((i) => [i.id, i]));

  const used = new Set();
  const wanted = list.map((r, n) => {
    const label = list.length > 1 ? `RFQ ${n + 1}: ` : '';
    const title = String(r.title || '').trim();
    if (!title) throw fail(`${label}give it a title`);
    const ids = [...new Set(Array.isArray(r.item_ids) ? r.item_ids : [])];
    if (list.length > 1 && !ids.length) throw fail(`${label}choose at least one item`);
    for (const id of ids) {
      if (!lines.has(id)) throw fail(`${label}one of the items is not on this requisition`);
      if (used.has(id)) throw fail(`${lines.get(id).item_name} is on more than one of these RFQs`);
      used.add(id);
    }
    return { title, description: r.description || null, item_ids: ids, supplier_ids: [...new Set(Array.isArray(r.supplier_ids) ? r.supplier_ids : [])] };
  });

  const numbers = new Set();
  for (const w of wanted) {
    let no;
    do { no = generateRFQNo(); } while (numbers.has(no) || await prisma.rFQ.findUnique({ where: { rfq_no: no } }));
    numbers.add(no);
    w.rfq_no = no;
  }

  const stamp = Date.now();
  const made = await prisma.$transaction(wanted.map((w) => prisma.rFQ.create({
    data: {
      rfq_no: w.rfq_no, requisition_id, title: w.title, description: w.description,
      item_ids: w.item_ids, opening_date: opens, closing_date: closes, status: 'OPEN',
      // a place for each invited supplier's quotation
      quotations: { create: w.supplier_ids.map((supplier_id, k) => ({ supplier_id, quotation_no: `Q/${stamp}/${k + 1}`, amount: 0 })) },
    },
    include: { requisition: { include: { department: { select: { name: true } }, items: true } } },
  })));
  return made.map((r) => ({ ...r, items: rfqItems(r) }));
};

// POST /api/rfqs - Create one RFQ from a requisition (item_ids chooses the lines; none = all)
const createRFQ = async (req, res) => {
  try {
    const { requisition_id, title, description, opening_date, closing_date, supplier_ids, item_ids } = req.body;
    const [rfq] = await makeRFQs({ requisition_id, opening_date, closing_date, list: [{ title, description, item_ids, supplier_ids }] });
    res.status(201).json(rfq);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/rfqs/batch - Several RFQs from one requisition, each with its own lines and suppliers
const createRFQBatch = async (req, res) => {
  try {
    const { requisition_id, opening_date, closing_date, rfqs } = req.body;
    const made = await makeRFQs({ requisition_id, opening_date, closing_date, list: rfqs });
    res.status(201).json({ rfqs: made });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/rfqs/:id - Update RFQ
const updateRFQ = async (req, res) => {
  try {
    const { title, description, opening_date, closing_date, status, notes } = req.body;

    const rfq = await prisma.rFQ.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(opening_date && { opening_date: new Date(opening_date) }),
        ...(closing_date && { closing_date: new Date(closing_date) }),
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
      },
    });

    res.json(rfq);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/rfqs/:id/quotations - Submit quotation
const submitQuotation = async (req, res) => {
  try {
    const { supplier_id, quotation_no, amount, currency, validity_period, notes } = req.body;

    if (!supplier_id || !quotation_no || !amount) {
      return res.status(400).json({ error: 'Supplier ID, quotation number, and amount are required' });
    }

    const quotation = await prisma.quotation.create({
      data: {
        rfq_id: req.params.id,
        supplier_id,
        quotation_no,
        amount: parseFloat(amount),
        currency: currency || 'KES',
        validity_period: validity_period ? parseInt(validity_period) : null,
        notes,
      },
      include: { supplier: true },
    });

    res.status(201).json(quotation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/rfqs/:id/quotations/:quotationId/select - Select winning quotation
// PATCH /api/rfqs/:id/award - Award RFQ to supplier
const selectQuotation = async (req, res) => {
  try {
    const rfq = await prisma.rFQ.findUnique({
      where: { id: req.params.id },
      include: { quotations: true },
    });

    if (!rfq) return res.status(404).json({ error: 'RFQ not found' });

    // Get quotation ID from either path params or request body
    const quotationId = req.params.quotationId || req.body.quotation_id;
    
    if (!quotationId) {
      return res.status(400).json({ error: 'Quotation ID is required' });
    }

    // Deselect all quotations
    await prisma.quotation.updateMany({
      where: { rfq_id: req.params.id },
      data: { is_selected: false },
    });

    // Select the winning quotation
    const quotation = await prisma.quotation.update({
      where: { id: quotationId },
      data: { is_selected: true },
      include: { supplier: true },
    });

    // Update RFQ with awarded supplier
    await prisma.rFQ.update({
      where: { id: req.params.id },
      data: {
        awarded_to: quotation.supplier_id,
        status: 'AWARDED',
      },
    });

    res.json(quotation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/rfqs/:id - Delete RFQ
const deleteRFQ = async (req, res) => {
  try {
    const rfq = await prisma.rFQ.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { lpos: true } } },
    });

    if (!rfq) return res.status(404).json({ error: 'RFQ not found' });

    if (rfq.status === 'AWARDED' && rfq._count.lpos > 0) {
      return res.status(400).json({ error: 'Cannot delete RFQ that has been awarded with LPOs' });
    }

    await prisma.rFQ.delete({ where: { id: req.params.id } });
    res.json({ message: 'RFQ deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/rfqs/:id/pdf - Generate RFQ PDF
const generateRFQPDF = async (req, res) => {
  try {
    const rfq = await prisma.rFQ.findUnique({
      where: { id: req.params.id },
      include: {
        requisition: {
          include: {
            department: { select: { name: true } },
            requester: { select: { email: true } },
            items: true,
          },
        },
        supplier: true,
        quotations: {
          include: { supplier: true },
        },
        lpos: true,
      },
    });

    if (!rfq) return res.status(404).json({ error: 'RFQ not found' });

    const pdfBuffer = await generateRFQ(rfq);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${rfq.rfq_no.replace(/\//g, '_')}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
};

module.exports = {
  getRFQs,
  getRFQById,
  createRFQ,
  createRFQBatch,
  updateRFQ,
  submitQuotation,
  selectQuotation,
  deleteRFQ,
  generateRFQPDF,
};
