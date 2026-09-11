const prisma = require('../config/db');
const { generateLPO } = require('../services/documentService');

// Generate LPO number
const generateLPONo = () => {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `LPO/${year}/${rand}`;
};

// GET /api/lpos - List LPOs
const getLPOs = async (req, res) => {
  try {
    const { status, supplier_id, department_id, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (supplier_id) where.supplier_id = supplier_id;
    if (department_id) where.department_id = department_id;

    const [lpos, total] = await Promise.all([
      prisma.lPO.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true, email: true } },
          department: { select: { id: true, name: true } },
          approver: { select: { email: true } },
          items: true,
          grns: true,
          invoices: true,
          _count: { select: { items: true, grns: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.lPO.count({ where }),
    ]);

    res.json({
      lpos,
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

// GET /api/lpos/:id - Get LPO by ID
const getLPOById = async (req, res) => {
  try {
    const lpo = await prisma.lPO.findUnique({
      where: { id: req.params.id },
      include: {
        rfq: {
          include: {
            requisition: {
              include: {
                department: { select: { name: true } },
                requester: { select: { email: true } },
              },
            },
          },
        },
        supplier: true,
        department: { select: { id: true, name: true } },
        approver: { select: { email: true } },
        items: true,
        grns: {
          include: { items: true },
        },
        invoices: true,
      },
    });

    if (!lpo) return res.status(404).json({ error: 'LPO not found' });

    res.json(lpo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/lpos - Create LPO
const createLPO = async (req, res) => {
  try {
    const {
      rfq_id,
      supplier_id,
      department_id,
      delivery_date,
      payment_terms,
      items,
    } = req.body;

    if (!supplier_id) {
      return res.status(400).json({ error: 'Supplier is required' });
    }
    if (!department_id) {
      return res.status(400).json({ error: 'Department is required' });
    }

    // If items not provided but rfq_id is, fetch items from RFQ's requisition
    let lpoItems = items;
    if ((!items || !Array.isArray(items) || items.length === 0) && rfq_id) {
      const rfq = await prisma.rFQ.findUnique({
        where: { id: rfq_id },
        include: {
          requisition: {
            include: { items: true },
          },
        },
      });
      if (rfq && rfq.requisition && rfq.requisition.items && rfq.requisition.items.length > 0) {
        lpoItems = rfq.requisition.items
          .filter(item => item.unit_price !== null && item.unit_price !== undefined)
          .map(item => ({
            item_name: item.item_name,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            specifications: item.specifications,
          }));
      }
    }

    if (!lpoItems || !Array.isArray(lpoItems) || lpoItems.length === 0) {
      return res.status(400).json({ error: 'At least one item with a valid unit price is required' });
    }

    // Calculate total amount
    const totalAmount = lpoItems.reduce((sum, item) => sum + (item.unit_price * item.quantity || 0), 0);

    const lpo = await prisma.lPO.create({
      data: {
        lpo_no: generateLPONo(),
        rfq_id,
        supplier_id,
        department_id,
        status: 'DRAFT',
        delivery_date: delivery_date ? new Date(delivery_date) : null,
        payment_terms,
        total_amount: totalAmount,
        currency: 'KES',
        items: {
          create: lpoItems.map(item => ({
            item_name: item.item_name,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.quantity * item.unit_price,
            specifications: item.specifications,
          })),
        },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        items: true,
      },
    });

    res.status(201).json(lpo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/lpos/:id/approve - Approve LPO
const approveLPO = async (req, res) => {
  try {
    const lpo = await prisma.lPO.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        approved_by: req.user.id,
        issue_date: new Date(),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        items: true,
      },
    });

    res.json(lpo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/lpos/:id/issue - Issue LPO
const issueLPO = async (req, res) => {
  try {
    const lpo = await prisma.lPO.update({
      where: { id: req.params.id },
      data: { status: 'ISSUED' },
    });

    res.json(lpo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/lpos/:id/pdf - Generate LPO PDF
const generateLPOPDF = async (req, res) => {
  try {
    const lpo = await prisma.lPO.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        department: true,
        items: true,
      },
    });

    if (!lpo) return res.status(404).json({ error: 'LPO not found' });

    const pdfBuffer = await generateLPO(lpo);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${lpo.lpo_no.replace(/\//g, '_')}.pdf"`);
    res.send(pdfBuffer);


  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
};

// DELETE /api/lpos/:id - Delete LPO
const deleteLPO = async (req, res) => {
  try {
    const lpo = await prisma.lPO.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { grns: true, invoices: true } } },
    });

    if (!lpo) return res.status(404).json({ error: 'LPO not found' });

    if (lpo.status === 'ISSUED' && (lpo._count.grns > 0 || lpo._count.invoices > 0)) {
      return res.status(400).json({ error: 'Cannot delete issued LPO with associated GRNs or invoices' });
    }

    await prisma.lPO.delete({ where: { id: req.params.id } });
    res.json({ message: 'LPO deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getLPOs,
  getLPOById,
  createLPO,
  approveLPO,
  issueLPO,
  generateLPOPDF,
  deleteLPO,
};
