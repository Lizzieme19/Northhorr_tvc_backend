const prisma = require('../config/db');

// Generate asset code
const generateAssetCode = () => {
  const year = new Date().getFullYear();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `AST/${year}/${rand}`;
};

// GET /api/assets - List assets
const getAssets = async (req, res) => {
  try {
    const { department_id, category, status, page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (department_id) where.department_id = department_id;
    if (category) where.category = category;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { asset_code: { contains: search, mode: 'insensitive' } },
        { serial_number: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [assets, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        include: {
          department: { select: { id: true, name: true } },
          custodian: {
            select: {
              id: true,
              employee_number: true,
              first_name: true,
              last_name: true,
              designation: { select: { title: true } },
            },
          },
          maintenance_records: {
            orderBy: { performed_date: 'desc' },
            take: 3,
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.asset.count({ where }),
    ]);

    res.json({
      assets,
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

// GET /api/assets/:id - Get asset by ID
const getAssetById = async (req, res) => {
  try {
    const asset = await prisma.asset.findUnique({
      where: { id: req.params.id },
      include: {
        department: true,
        custodian: {
          include: {
            user: { select: { email: true } },
            designation: { select: { title: true } },
          },
        },
        maintenance_records: {
          orderBy: { performed_date: 'desc' },
        },
      },
    });

    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    // Calculate current value
    const currentValue = asset.purchase_cost - asset.accumulated_depreciation;

    res.json({
      ...asset,
      current_value: currentValue,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/assets - Create asset
const createAsset = async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      serial_number,
      purchase_date,
      purchase_cost,
      location,
      department_id,
      custodian_id,
      depreciation_rate,
      useful_life,
    } = req.body;

    if (!name || !purchase_cost || !purchase_date) {
      return res.status(400).json({ error: 'Name, purchase cost, and purchase date are required' });
    }

    const asset = await prisma.asset.create({
      data: {
        asset_code: generateAssetCode(),
        name,
        description,
        category,
        serial_number,
        purchase_date: new Date(purchase_date),
        purchase_cost: parseFloat(purchase_cost),
        current_value: parseFloat(purchase_cost),
        location,
        department_id,
        custodian_id,
        depreciation_rate: depreciation_rate ? parseFloat(depreciation_rate) : null,
        useful_life: useful_life ? parseInt(useful_life) : null,
        status: 'ACTIVE',
      },
      include: {
        department: { select: { name: true } },
        custodian: {
          select: {
            employee_number: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });

    res.status(201).json(asset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/assets/:id - Update asset
const updateAsset = async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      serial_number,
      location,
      department_id,
      custodian_id,
      depreciation_rate,
      useful_life,
      status,
    } = req.body;

    const asset = await prisma.asset.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(serial_number !== undefined && { serial_number }),
        ...(location !== undefined && { location }),
        ...(department_id !== undefined && { department_id }),
        ...(custodian_id !== undefined && { custodian_id }),
        ...(depreciation_rate !== undefined && { depreciation_rate: depreciation_rate ? parseFloat(depreciation_rate) : null }),
        ...(useful_life !== undefined && { useful_life: useful_life ? parseInt(useful_life) : null }),
        ...(status && { status }),
      },
      include: {
        department: { select: { name: true } },
        custodian: {
          select: {
            employee_number: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });

    res.json(asset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/assets/:id/depreciate - Calculate and record depreciation
const calculateDepreciation = async (req, res) => {
  try {
    const asset = await prisma.asset.findUnique({
      where: { id: req.params.id },
    });

    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    if (!asset.depreciation_rate || !asset.useful_life) {
      return res.status(400).json({ error: 'Asset does not have depreciation settings' });
    }

    // Calculate annual depreciation (straight-line method)
    const annualDepreciation = (asset.purchase_cost * asset.depreciation_rate) / 100;
    
    // Calculate years since purchase
    const yearsSincePurchase = Math.floor((new Date() - new Date(asset.purchase_date)) / (365.25 * 24 * 60 * 60 * 1000));
    
    // Calculate total depreciation
    const totalDepreciation = Math.min(annualDepreciation * yearsSincePurchase, asset.purchase_cost);
    
    // Update asset
    const updated = await prisma.asset.update({
      where: { id: req.params.id },
      data: {
        accumulated_depreciation: totalDepreciation,
        current_value: asset.purchase_cost - totalDepreciation,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/assets/:id/maintenance - Record maintenance
const recordMaintenance = async (req, res) => {
  try {
    const { maintenance_type, description, cost, performed_by, next_due_date } = req.body;

    if (!maintenance_type || !description || !performed_date) {
      return res.status(400).json({ error: 'Maintenance type, description, and performed date are required' });
    }

    const maintenance = await prisma.maintenanceRecord.create({
      data: {
        asset_id: req.params.id,
        maintenance_type,
        description,
        cost: cost ? parseFloat(cost) : null,
        performed_by,
        performed_date: new Date(performed_date),
        next_due_date: next_due_date ? new Date(next_due_date) : null,
      },
      include: {
        asset: {
          select: {
            asset_code: true,
            name: true,
          },
        },
      },
    });

    res.status(201).json(maintenance);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/assets/:id/dispose - Dispose asset
const disposeAsset = async (req, res) => {
  try {
    const { disposal_reason, disposal_date } = req.body;

    const asset = await prisma.asset.update({
      where: { id: req.params.id },
      data: {
        status: 'DISPOSED',
        disposal_reason,
        disposal_date: disposal_date ? new Date(disposal_date) : new Date(),
      },
    });

    res.json(asset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/assets/:id - Delete asset
const deleteAsset = async (req, res) => {
  try {
    await prisma.asset.delete({ where: { id: req.params.id } });
    res.json({ message: 'Asset deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAssets,
  getAssetById,
  createAsset,
  updateAsset,
  calculateDepreciation,
  recordMaintenance,
  disposeAsset,
  deleteAsset,
};
