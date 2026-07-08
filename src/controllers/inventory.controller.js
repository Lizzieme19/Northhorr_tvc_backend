const prisma = require('../config/db');

// GET /api/inventory - List inventory items
const getInventory = async (req, res) => {
  try {
    const { category, reorder_alert, page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (category) where.category = category;
    if (reorder_alert === 'true') {
      where.current_stock = { lte: prisma.inventoryItem.fields.reorder_level };
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { item_code: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          stock_movements: {
            orderBy: { created_at: 'desc' },
            take: 5,
          },
        },
        orderBy: { name: 'asc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.inventoryItem.count({ where }),
    ]);

    // Add reorder alert flag
    const itemsWithAlert = items.map(item => ({
      ...item,
      reorder_alert: item.current_stock <= item.reorder_level,
    }));

    res.json({
      items: itemsWithAlert,
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

// GET /api/inventory/alerts - Get items needing reorder
const getReorderAlerts = async (req, res) => {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: {
        current_stock: { lte: prisma.inventoryItem.fields.reorder_level },
      },
      include: {
        supplier: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { current_stock: 'asc' },
    });

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/inventory/:id - Get inventory item by ID
const getInventoryItemById = async (req, res) => {
  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        stock_movements: {
          orderBy: { created_at: 'desc' },
          take: 20,
        },
      },
    });

    if (!item) return res.status(404).json({ error: 'Inventory item not found' });

    res.json({
      ...item,
      reorder_alert: item.current_stock <= item.reorder_level,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/inventory - Create inventory item
const createInventoryItem = async (req, res) => {
  try {
    const {
      item_code,
      name,
      description,
      category,
      unit_of_measure,
      current_stock,
      minimum_stock,
      maximum_stock,
      reorder_level,
      location,
      unit_cost,
      supplier_id,
    } = req.body;

    if (!item_code || !name) {
      return res.status(400).json({ error: 'Item code and name are required' });
    }

    const item = await prisma.inventoryItem.create({
      data: {
        item_code,
        name,
        description,
        category,
        unit_of_measure,
        current_stock: current_stock || 0,
        minimum_stock: minimum_stock || 0,
        maximum_stock: maximum_stock ? parseInt(maximum_stock) : null,
        reorder_level: reorder_level || 0,
        location,
        unit_cost: unit_cost ? parseFloat(unit_cost) : null,
        supplier_id,
      },
      include: { supplier: true },
    });

    // Record initial stock movement
    if (current_stock > 0) {
      await prisma.stockMovement.create({
        data: {
          inventory_item_id: item.id,
          movement_type: 'IN',
          quantity: current_stock,
          notes: 'Initial stock',
          performed_by: req.user.id,
        },
      });
    }

    res.status(201).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/inventory/:id - Update inventory item
const updateInventoryItem = async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      unit_of_measure,
      minimum_stock,
      maximum_stock,
      reorder_level,
      location,
      unit_cost,
      supplier_id,
    } = req.body;

    const item = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(unit_of_measure !== undefined && { unit_of_measure }),
        ...(minimum_stock !== undefined && { minimum_stock: parseInt(minimum_stock) }),
        ...(maximum_stock !== undefined && { maximum_stock: maximum_stock ? parseInt(maximum_stock) : null }),
        ...(reorder_level !== undefined && { reorder_level: parseInt(reorder_level) }),
        ...(location !== undefined && { location }),
        ...(unit_cost !== undefined && { unit_cost: unit_cost ? parseFloat(unit_cost) : null }),
        ...(supplier_id !== undefined && { supplier_id }),
      },
      include: { supplier: true },
    });

    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/inventory/:id/adjust - Adjust stock
const adjustStock = async (req, res) => {
  try {
    const { quantity, movement_type, notes } = req.body;

    if (!quantity || !movement_type || !['IN', 'OUT', 'ADJUSTMENT'].includes(movement_type)) {
      return res.status(400).json({ error: 'Quantity and valid movement type (IN, OUT, ADJUSTMENT) are required' });
    }

    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
    });

    if (!item) return res.status(404).json({ error: 'Inventory item not found' });

    // Calculate new stock
    let newStock = item.current_stock;
    if (movement_type === 'IN' || movement_type === 'ADJUSTMENT') {
      newStock += parseInt(quantity);
    } else if (movement_type === 'OUT') {
      newStock -= parseInt(quantity);
      if (newStock < 0) {
        return res.status(400).json({ error: 'Insufficient stock' });
      }
    }

    // Update stock
    const updated = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: { current_stock: newStock },
    });

    // Record movement
    await prisma.stockMovement.create({
      data: {
        inventory_item_id: item.id,
        movement_type,
        quantity: parseInt(quantity),
        notes,
        performed_by: req.user.id,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/inventory/:id - Delete inventory item
const deleteInventoryItem = async (req, res) => {
  try {
    await prisma.inventoryItem.delete({ where: { id: req.params.id } });
    res.json({ message: 'Inventory item deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getInventory,
  getReorderAlerts,
  getInventoryItemById,
  createInventoryItem,
  updateInventoryItem,
  adjustStock,
  deleteInventoryItem,
};
