const prisma = require('../config/db');

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
      rfqs,
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

    res.json(rfq);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/rfqs - Create RFQ from requisition
const createRFQ = async (req, res) => {
  try {
    const { requisition_id, title, description, opening_date, closing_date, supplier_ids } = req.body;

    if (!requisition_id || !title || !opening_date || !closing_date) {
      return res.status(400).json({ error: 'Requisition ID, title, opening date, and closing date are required' });
    }

    const rfq = await prisma.rFQ.create({
      data: {
        rfq_no: generateRFQNo(),
        requisition_id,
        title,
        description,
        opening_date: new Date(opening_date),
        closing_date: new Date(closing_date),
        status: 'OPEN',
      },
      include: {
        requisition: {
          include: {
            department: { select: { name: true } },
            items: true,
          },
        },
      },
    });

    // Create quotations for invited suppliers
    if (supplier_ids && Array.isArray(supplier_ids)) {
      for (const supplier_id of supplier_ids) {
        await prisma.quotation.create({
          data: {
            rfq_id: rfq.id,
            supplier_id,
            quotation_no: `Q/${Date.now()}`,
            amount: 0,
          },
        });
      }
    }

    res.status(201).json(rfq);
  } catch (err) {
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
const selectQuotation = async (req, res) => {
  try {
    const rfq = await prisma.rFQ.findUnique({
      where: { id: req.params.id },
      include: { quotations: true },
    });

    if (!rfq) return res.status(404).json({ error: 'RFQ not found' });

    // Deselect all quotations
    await prisma.quotation.updateMany({
      where: { rfq_id: req.params.id },
      data: { is_selected: false },
    });

    // Select the winning quotation
    const quotation = await prisma.quotation.update({
      where: { id: req.params.quotationId },
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

module.exports = {
  getRFQs,
  getRFQById,
  createRFQ,
  updateRFQ,
  submitQuotation,
  selectQuotation,
  deleteRFQ,
};
