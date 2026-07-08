const prisma = require('../config/db');

// GET /api/invoices - List supplier invoices
const getInvoices = async (req, res) => {
  try {
    const { status, supplier_id, lpo_id, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (supplier_id) where.supplier_id = supplier_id;
    if (lpo_id) where.lpo_id = lpo_id;

    const [invoices, total] = await Promise.all([
      prisma.supplierInvoice.findMany({
        where,
        include: {
          lpo: {
            include: {
              supplier: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
          supplier: { select: { id: true, name: true, email: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.supplierInvoice.count({ where }),
    ]);

    res.json({
      invoices,
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

// GET /api/invoices/:id - Get invoice by ID
const getInvoiceById = async (req, res) => {
  try {
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: req.params.id },
      include: {
        lpo: {
          include: {
            supplier: true,
            department: { select: { name: true } },
            items: true,
          },
        },
        supplier: true,
      },
    });

    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    res.json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/invoices - Create supplier invoice
const createInvoice = async (req, res) => {
  try {
    const {
      lpo_id,
      supplier_id,
      invoice_no,
      amount,
      currency,
      invoice_date,
      due_date,
      notes,
      attachment_url,
    } = req.body;

    if (!lpo_id || !supplier_id || !invoice_no || !amount || !invoice_date) {
      return res.status(400).json({ error: 'LPO ID, supplier ID, invoice number, amount, and invoice date are required' });
    }

    const invoice = await prisma.supplierInvoice.create({
      data: {
        lpo_id,
        supplier_id,
        invoice_no,
        amount: parseFloat(amount),
        currency: currency || 'KES',
        invoice_date: new Date(invoice_date),
        due_date: due_date ? new Date(due_date) : null,
        notes,
        attachment_url,
        status: 'PENDING',
      },
      include: {
        lpo: {
          include: {
            supplier: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        supplier: { select: { name: true } },
      },
    });

    res.status(201).json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/invoices/:id - Update invoice
const updateInvoice = async (req, res) => {
  try {
    const {
      amount,
      currency,
      invoice_date,
      due_date,
      notes,
      attachment_url,
    } = req.body;

    const invoice = await prisma.supplierInvoice.update({
      where: { id: req.params.id },
      data: {
        ...(amount && { amount: parseFloat(amount) }),
        ...(currency && { currency }),
        ...(invoice_date && { invoice_date: new Date(invoice_date) }),
        ...(due_date !== undefined && { due_date: due_date ? new Date(due_date) : null }),
        ...(notes !== undefined && { notes }),
        ...(attachment_url !== undefined && { attachment_url }),
      },
      include: {
        supplier: { select: { name: true } },
      },
    });

    res.json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/invoices/:id/pay - Record payment
const recordPayment = async (req, res) => {
  try {
    const { paid_amount, payment_date } = req.body;

    if (!paid_amount) {
      return res.status(400).json({ error: 'Paid amount is required' });
    }

    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: req.params.id },
    });

    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const newPaidAmount = invoice.paid_amount + parseFloat(paid_amount);
    const status = newPaidAmount >= invoice.amount ? 'PAID' : newPaidAmount > 0 ? 'PARTIAL' : 'PENDING';

    const updated = await prisma.supplierInvoice.update({
      where: { id: req.params.id },
      data: {
        paid_amount: newPaidAmount,
        payment_date: payment_date ? new Date(payment_date) : new Date(),
        status,
      },
      include: {
        lpo: {
          include: {
            supplier: { select: { name: true } },
          },
        },
        supplier: { select: { name: true } },
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/invoices/:id - Delete invoice
const deleteInvoice = async (req, res) => {
  try {
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: req.params.id },
    });

    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    if (invoice.status === 'PAID') {
      return res.status(400).json({ error: 'Cannot delete paid invoice' });
    }

    await prisma.supplierInvoice.delete({ where: { id: req.params.id } });
    res.json({ message: 'Invoice deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getInvoices,
  getInvoiceById,
  createInvoice,
  updateInvoice,
  recordPayment,
  deleteInvoice,
};
