const prisma = require('../config/db');

// GET /api/suppliers - List all suppliers
const getSuppliers = async (req, res) => {
  try {
    const { is_approved, page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (is_approved !== undefined) where.is_approved = is_approved === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { contact_person: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        include: {
          _count: {
            select: { lpos: true, invoices: true },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.supplier.count({ where }),
    ]);

    res.json({
      suppliers,
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

// GET /api/suppliers/:id - Get supplier by ID
const getSupplierById = async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        lpos: { orderBy: { created_at: 'desc' }, take: 5 },
        invoices: { orderBy: { created_at: 'desc' }, take: 5 },
        rfqs: { orderBy: { created_at: 'desc' }, take: 5 },
      },
    });

    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    res.json(supplier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/suppliers - Create supplier (PROCUREMENT, ADMIN)
const createSupplier = async (req, res) => {
  try {
    const {
      name,
      contact_person,
      email,
      phone,
      address,
      city,
      country,
      tax_id,
      registration_number,
      is_approved,
      rating,
      notes,
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const supplier = await prisma.supplier.create({
      data: {
        name,
        contact_person,
        email,
        phone,
        address,
        city,
        country,
        tax_id,
        registration_number,
        is_approved: is_approved || false,
        rating: rating ? parseFloat(rating) : 0,
        notes,
      },
    });

    res.status(201).json(supplier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/suppliers/:id - Update supplier (PROCUREMENT, ADMIN)
const updateSupplier = async (req, res) => {
  try {
    const {
      name,
      contact_person,
      email,
      phone,
      address,
      city,
      country,
      tax_id,
      registration_number,
      is_approved,
      rating,
      notes,
    } = req.body;

    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(contact_person !== undefined && { contact_person }),
        ...(email !== undefined && { email }),
        ...(phone && { phone }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(country !== undefined && { country }),
        ...(tax_id !== undefined && { tax_id }),
        ...(registration_number !== undefined && { registration_number }),
        ...(is_approved !== undefined && { is_approved }),
        ...(rating !== undefined && { rating: parseFloat(rating) }),
        ...(notes !== undefined && { notes }),
      },
    });

    res.json(supplier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/suppliers/:id - Delete supplier (PROCUREMENT, ADMIN)
const deleteSupplier = async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { lpos: true, invoices: true } } },
    });

    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    if (supplier._count.lpos > 0 || supplier._count.invoices > 0) {
      return res.status(400).json({ error: 'Cannot delete supplier with associated LPOs or invoices' });
    }

    await prisma.supplier.delete({ where: { id: req.params.id } });
    res.json({ message: 'Supplier deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/suppliers/:id/approve - Approve supplier (PROCUREMENT, ADMIN)
const approveSupplier = async (req, res) => {
  try {
    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data: { is_approved: true },
    });

    res.json(supplier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  approveSupplier,
};
