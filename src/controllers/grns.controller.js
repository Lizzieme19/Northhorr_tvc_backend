const prisma = require('../config/db');
const { generateGRN } = require('../services/documentService');
const { readLineKind, carryKind, knownUnits, normalizeUnit, nextStockCode } = require('../services/procurementItemService');

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

    if (!lpo_id) {
      return res.status(400).json({ error: 'LPO ID is required' });
    }

    // If items not provided, fetch items from LPO
    let grnItems = items;
    if ((!items || !Array.isArray(items) || items.length === 0) && lpo_id) {
      const lpo = await prisma.lPO.findUnique({
        where: { id: lpo_id },
        include: { items: true },
      });
      if (lpo && lpo.items && lpo.items.length > 0) {
        grnItems = lpo.items.map(item => ({
          item_name: item.item_name,
          quantity_ordered: item.quantity,
          quantity_received: item.quantity,
          quantity_accepted: item.quantity,
          batch_number: null,
          expiry_date: null,
          condition: 'GOOD',
          notes: null,
          unit_price: item.unit_price,
          ...carryKind(item),
        }));
      }
    }

    if (!grnItems || !Array.isArray(grnItems) || grnItems.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    const units = await knownUnits();
    const lineKinds = grnItems.map(item => readLineKind(item, units));

    const grn = await prisma.gRN.create({
      data: {
        grn_no: generateGRNNo(),
        lpo_id,
        received_by: req.user.id,
        status: 'PENDING',
        notes,
        discrepancies,
        items: {
          create: grnItems.map((item, i) => ({
            ...lineKinds[i],
            unit_price: item.unit_price ?? null,
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
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// What a verified line has become, so the screen can say "3 to tag" or "stock +40 reams"
const matchStockItem = async (line) => {
  if (line.inventory_item_id) {
    const byId = await prisma.inventoryItem.findUnique({ where: { id: line.inventory_item_id } });
    if (byId) return byId;
  }
  return prisma.inventoryItem.findFirst({ where: { name: { equals: line.item_name, mode: 'insensitive' } } });
};

// PATCH /api/grns/:id/items/:itemId - say what a received line is, or correct what was received (while pending)
const updateGRNItem = async (req, res) => {
  try {
    const grn = await prisma.gRN.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!grn) return res.status(404).json({ error: 'GRN not found' });
    if (grn.status !== 'PENDING') return res.status(400).json({ error: 'Only a pending GRN can be changed' });
    const line = grn.items.find((i) => i.id === req.params.itemId);
    if (!line) return res.status(404).json({ error: 'GRN line not found' });

    const b = req.body || {};
    const data = {};
    if (b.item_type !== undefined || b.asset_class !== undefined || b.unit_of_measure !== undefined || b.inventory_item_id !== undefined) {
      Object.assign(data, readLineKind({ ...carryKind(line), ...b }, await knownUnits()));
    }
    const whole = (v, label) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 0) throw Object.assign(new Error(`${label} must be a whole number, 0 or more`), { status: 400 });
      return n;
    };
    const received = b.quantity_received !== undefined ? whole(b.quantity_received, 'Quantity received') : line.quantity_received;
    const accepted = b.quantity_accepted !== undefined ? whole(b.quantity_accepted, 'Quantity accepted') : line.quantity_accepted;
    if (accepted > received) return res.status(400).json({ error: 'More was accepted than was received' });
    if (b.quantity_received !== undefined) data.quantity_received = received;
    if (b.quantity_accepted !== undefined) data.quantity_accepted = accepted;
    if (b.condition !== undefined) data.condition = b.condition || 'GOOD';

    res.json(await prisma.gRNItem.update({ where: { id: line.id }, data }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/grns/:id/verify - Verify GRN
// Consumables go into Inventory straight away (new items are created, in their unit of measure). Assets are
// not tagged automatically: they wait in the "ready to tag" list so a person can confirm the quantity and add
// serial numbers and locations, because tag numbers are permanent.
const verifyGRN = async (req, res) => {
  try {
    const { status, notes } = req.body;

    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be VERIFIED or REJECTED' });
    }

    const existing = await prisma.gRN.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!existing) return res.status(404).json({ error: 'GRN not found' });
    if (existing.status !== 'PENDING') return res.status(400).json({ error: `This GRN is already ${existing.status.toLowerCase()}` });

    // Work out what each line is before changing anything, so a problem leaves everything as it was
    const plan = [];
    const unclear = [];
    if (status === 'VERIFIED') {
      for (const line of existing.items) {
        if (line.quantity_accepted <= 0) { plan.push({ line, kind: 'NONE' }); continue; }
        if (line.item_type === 'ASSET') { plan.push({ line, kind: 'ASSET' }); continue; }
        const stock = await matchStockItem(line);
        if (line.item_type === 'CONSUMABLE' || stock) plan.push({ line, kind: 'STOCK', stock });
        else unclear.push(line.item_name);
      }
      if (unclear.length) {
        return res.status(400).json({
          error: `Say what ${unclear.length === 1 ? 'this item is' : 'these items are'} before verifying (a consumable for Inventory, or an asset to be tagged): ${unclear.join(', ')}`,
          unclassified: unclear,
        });
      }
    }

    const grn = await prisma.gRN.update({
      where: { id: req.params.id },
      data: { status, notes },
      include: { lpo: { include: { supplier: { select: { name: true } } } }, items: true },
    });

    const summary = { stock_lines: 0, new_stock_items: 0, assets_to_tag: 0 };
    if (status === 'VERIFIED') {
      for (const { line, kind, stock } of plan) {
        if (kind === 'ASSET') { summary.assets_to_tag += line.quantity_accepted; continue; }
        if (kind !== 'STOCK') continue;
        let item = stock;
        if (!item) {
          item = await prisma.inventoryItem.create({
            data: {
              item_code: await nextStockCode(),
              name: line.item_name,
              unit_of_measure: normalizeUnit(line.unit_of_measure) || 'pcs',
              unit_cost: line.unit_price ?? null,
              current_stock: 0,
              supplier_id: grn.lpo?.supplier_id || null,
            },
          });
          summary.new_stock_items += 1;
        } else if (!item.unit_of_measure && line.unit_of_measure) {
          await prisma.inventoryItem.update({ where: { id: item.id }, data: { unit_of_measure: normalizeUnit(line.unit_of_measure) } });
        }
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: { current_stock: { increment: line.quantity_accepted }, ...(line.unit_price != null && { unit_cost: line.unit_price }) },
        });
        await prisma.stockMovement.create({
          data: { inventory_item_id: item.id, movement_type: 'IN', quantity: line.quantity_accepted, reference: grn.grn_no, notes: `Received on ${grn.lpo?.lpo_no || 'LPO'}`, performed_by: req.user.id },
        });
        summary.stock_lines += 1;
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

    res.json({ ...grn, received: summary });
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

// GET /api/grns/:id/pdf - Generate GRN PDF
const generateGRNPDF = async (req, res) => {
  try {
    const grn = await prisma.gRN.findUnique({
      where: { id: req.params.id },
      include: {
        lpo: {
          include: {
            supplier: true,
            department: true,
          },
        },
        items: true,
      },
    });

    if (!grn) return res.status(404).json({ error: 'GRN not found' });

    const pdfBuffer = await generateGRN(grn);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${grn.grn_no.replace(/\//g, '_')}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
};

module.exports = {
  getGRNs,
  getGRNById,
  createGRN,
  verifyGRN,
  updateGRNItem,
  deleteGRN,
  generateGRNPDF,
};
