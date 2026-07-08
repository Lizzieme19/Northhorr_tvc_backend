const prisma = require('../config/db');

// Generate requisition number
const generateRequisitionNo = () => {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `REQ/${year}/${rand}`;
};

// GET /api/requisitions - List purchase requisitions
const getRequisitions = async (req, res) => {
  try {
    const { department_id, status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (department_id) where.department_id = department_id;
    if (status) where.status = status;

    const [requisitions, total] = await Promise.all([
      prisma.purchaseRequisition.findMany({
        where,
        include: {
          department: { select: { id: true, name: true } },
          requester: { select: { email: true } },
          approver: { select: { email: true } },
          items: true,
          _count: { select: { items: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.purchaseRequisition.count({ where }),
    ]);

    res.json({
      requisitions,
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

// GET /api/requisitions/:id - Get requisition by ID
const getRequisitionById = async (req, res) => {
  try {
    const requisition = await prisma.purchaseRequisition.findUnique({
      where: { id: req.params.id },
      include: {
        department: { select: { id: true, name: true } },
        requester: { select: { email: true } },
        approver: { select: { email: true } },
        items: true,
        rfqs: true,
      },
    });

    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });

    res.json(requisition);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/requisitions - Create purchase requisition
const createRequisition = async (req, res) => {
  try {
    const { department_id, priority, justification, items } = req.body;

    if (!department_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Department and items are required' });
    }

    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => sum + (item.unit_price * item.quantity || 0), 0);

    const requisition = await prisma.purchaseRequisition.create({
      data: {
        requisition_no: generateRequisitionNo(),
        department_id,
        requested_by: req.user.id,
        priority,
        justification,
        total_amount: totalAmount,
        status: 'DRAFT',
        items: {
          create: items.map(item => ({
            item_name: item.item_name,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.quantity * (item.unit_price || 0),
            specifications: item.specifications,
          })),
        },
      },
      include: {
        department: { select: { id: true, name: true } },
        items: true,
      },
    });

    res.status(201).json(requisition);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/requisitions/:id - Update requisition
const updateRequisition = async (req, res) => {
  try {
    const { priority, justification, status } = req.body;

    const requisition = await prisma.purchaseRequisition.update({
      where: { id: req.params.id },
      data: {
        ...(priority && { priority }),
        ...(justification !== undefined && { justification }),
        ...(status && { status }),
      },
      include: {
        department: { select: { id: true, name: true } },
        items: true,
      },
    });

    res.json(requisition);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/requisitions/:id/submit - Submit requisition for approval
const submitRequisition = async (req, res) => {
  try {
    const requisition = await prisma.purchaseRequisition.update({
      where: { id: req.params.id },
      data: { status: 'PENDING_APPROVAL' },
    });

    res.json(requisition);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/requisitions/:id/approve - Approve or reject requisition
const approveRequisition = async (req, res) => {
  try {
    const { status, rejection_reason } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be APPROVED or REJECTED' });
    }

    const requisition = await prisma.purchaseRequisition.update({
      where: { id: req.params.id },
      data: {
        status,
        approved_by: req.user.id,
        approved_at: new Date(),
        rejection_reason: status === 'REJECTED' ? rejection_reason : null,
      },
    });

    res.json(requisition);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/requisitions/:id - Delete requisition
const deleteRequisition = async (req, res) => {
  try {
    const requisition = await prisma.purchaseRequisition.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { rfqs: true } } },
    });

    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });

    if (requisition.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Can only delete draft requisitions' });
    }

    if (requisition._count.rfqs > 0) {
      return res.status(400).json({ error: 'Cannot delete requisition with associated RFQs' });
    }

    await prisma.purchaseRequisition.delete({ where: { id: req.params.id } });
    res.json({ message: 'Requisition deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getRequisitions,
  getRequisitionById,
  createRequisition,
  updateRequisition,
  submitRequisition,
  approveRequisition,
  deleteRequisition,
};
