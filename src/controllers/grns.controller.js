const prisma = require('../config/db');

// Generate GRN number
const generateGRNNo = () => {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `GRN/${year}/${rand}`;
};

// GET /api/grns - List GRNs
const getGRNs = async (req, res) => {
  try {
    const { lpo_id, status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (lpo_id) where.lpo_id = lpo_id;
    if (status) where.status = status;

    const [grns, total] = await Promise.all([
      prisma.gRN.findMany({
        where,
        include: {
          lpo: {
            include: {
              supplier: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
          items: true,
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.gRN.count({ where }),
    ]);

    res.json({
      grns,
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

// GET /api/grns/:id - Get GRN by ID
const getGRNById = async (req, res) => {
  try {
    const grn = await prisma.gRN.findUnique({
      where: { id: req.params.id },
      include: {
        lpo: {
          include: {
            supplier: true,
            department: { select: { name: true } },
            items: true,
          },
        },
        items: true,
      },
    });

    if (!grn) return res.status(404).json({ error: 'GRN not found' });

    res.json(grn);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/grns - Create GRN
const createGRN = async (req, res) => {
  try {
    const { lpo_id, items, notes, discrepancies } = req.body;

    if (!lpo_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'LPO ID and items are required' });
    }

    const grn = await prisma.gRN.create({
      data: {
        grn_no: generateGRNNo(),
        lpo_id,
        received_by: req.user.id,
        status: 'PENDING',
        notes,
        discrepancies,
        items: {
          create: items.map(item => ({
            item_name: item.item_name,
            quantity_ordered: item.quantity_ordered,
            quantity_received: item.quantity_received,
            quantity_accepted: item.quantity_accepted,
            batch_number: item.batch_number,
            expiry_date: item.expiry_date ? new Date(item.expiry_date) : null,
            condition: item.condition || 'GOOD',
            notes: item.notes,
          })),
        },
      },
      include: {
        lpo: {
          include: {
            supplier: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        items: true,
      },
    });

    res.status(201).json(grn);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/grns/:id/verify - Verify GRN
const verifyGRN = async (req, res) => {
  try {
    const { status, notes } = req.body;

    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be VERIFIED or REJECTED' });
    }

    const grn = await prisma.gRN.update({
      where: { id: req.params.id },
      data: {
        status,
        notes,
      },
      include: {
        lpo: {
          include: {
            supplier: { select: { name: true } },
          },
        },
        items: true,
      },
    });

    // If verified, update inventory stock
    if (status === 'VERIFIED') {
      for (const item of grn.items) {
        // Find or create inventory item
        let inventoryItem = await prisma.inventoryItem.findFirst({
          where: { name: item.item_name },
        });

        if (inventoryItem) {
          // Update stock
          await prisma.inventoryItem.update({
            where: { id: inventoryItem.id },
            data: {
              current_stock: { increment: item.quantity_accepted },
            },
          });

          // Record stock movement
          await prisma.stockMovement.create({
            data: {
              inventory_item_id: inventoryItem.id,
              movement_type: 'IN',
              quantity: item.quantity_accepted,
              reference: grn.grn_no,
              performed_by: req.user.id,
            },
          });
        }
      }

      // Update LPO status if all items received
      const lpo = await prisma.lPO.findUnique({
        where: { id: grn.lpo_id },
        include: { _count: { select: { grns: true } } },
      });

      if (lpo) {
        await prisma.lPO.update({
          where: { id: grn.lpo_id },
          data: { status: 'FULLY_RECEIVED' },
        });
      }
    }

    res.json(grn);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/grns/:id - Delete GRN
const deleteGRN = async (req, res) => {
  try {
    const grn = await prisma.gRN.findUnique({
      where: { id: req.params.id },
    });

    if (!grn) return res.status(404).json({ error: 'GRN not found' });

    if (grn.status === 'VERIFIED') {
      return res.status(400).json({ error: 'Cannot delete verified GRN' });
    }

    await prisma.gRN.delete({ where: { id: req.params.id } });
    res.json({ message: 'GRN deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getGRNs,
  getGRNById,
  createGRN,
  verifyGRN,
  deleteGRN,
};
