const prisma = require('../config/db');
const PDFDocument = require('pdfkit');

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

    if (!supplier_id || !department_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Supplier, department, and items are required' });
    }

    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => sum + (item.unit_price * item.quantity || 0), 0);

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
          create: items.map(item => ({
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

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('NORTH HORR TECHNICAL & VOCATIONAL COLLEGE', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('Local Purchase Order', { align: 'center' });
    doc.moveDown();

    // LPO Details
    doc.fontSize(12).font('Helvetica-Bold').text(`LPO No: ${lpo.lpo_no}`);
    doc.fontSize(12).font('Helvetica').text(`Issue Date: ${lpo.issue_date ? lpo.issue_date.toLocaleDateString() : 'N/A'}`);
    doc.fontSize(12).font('Helvetica').text(`Status: ${lpo.status}`);
    doc.moveDown();

    // Supplier Details
    doc.fontSize(14).font('Helvetica-Bold').text('Supplier Details:');
    doc.fontSize(12).font('Helvetica').text(`Name: ${lpo.supplier.name}`);
    doc.fontSize(12).font('Helvetica').text(`Contact: ${lpo.supplier.contact_person || 'N/A'}`);
    doc.fontSize(12).font('Helvetica').text(`Phone: ${lpo.supplier.phone}`);
    doc.fontSize(12).font('Helvetica').text(`Email: ${lpo.supplier.email || 'N/A'}`);
    doc.moveDown();

    // Department
    doc.fontSize(14).font('Helvetica-Bold').text('Department:');
    doc.fontSize(12).font('Helvetica').text(lpo.department.name);
    doc.moveDown();

    // Items Table
    doc.fontSize(14).font('Helvetica-Bold').text('Items:');
    doc.moveDown();

    let y = doc.y;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Item', 50, y);
    doc.text('Qty', 300, y);
    doc.text('Unit Price', 350, y);
    doc.text('Total', 450, y);

    y += 20;
    doc.fontSize(10).font('Helvetica');
    lpo.items.forEach((item) => {
      doc.text(item.item_name, 50, y);
      doc.text(item.quantity.toString(), 300, y);
      doc.text(`KES ${item.unit_price.toLocaleString()}`, 350, y);
      doc.text(`KES ${item.total_price.toLocaleString()}`, 450, y);
      y += 20;
    });

    // Total
    y += 10;
    doc.fontSize(12).font('Helvetica-Bold').text(`Total Amount: KES ${lpo.total_amount.toLocaleString()}`, 350, y);

    // Payment Terms
    doc.moveDown();
    doc.fontSize(14).font('Helvetica-Bold').text('Payment Terms:');
    doc.fontSize(12).font('Helvetica').text(lpo.payment_terms || 'N/A');

    // Delivery Date
    doc.moveDown();
    doc.fontSize(14).font('Helvetica-Bold').text('Expected Delivery:');
    doc.fontSize(12).font('Helvetica').text(lpo.delivery_date ? lpo.delivery_date.toLocaleDateString() : 'N/A');

    // Footer
    doc.moveDown(2);
    doc.fontSize(10).font('Helvetica').text('This is a computer-generated document.', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('North Horr Technical & Vocational College.', { align: 'center' });

    doc.end();

    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${lpo.lpo_no}.pdf"`);
      res.send(pdfBuffer);
    });
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
