const prisma = require('../config/db');

// GET /api/audit - List audit trail entries
const getAuditTrail = async (req, res) => {
  try {
    const { entity_type, action, user_id, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (entity_type) where.entity_type = entity_type;
    if (action) where.action = action;
    if (user_id) where.user_id = user_id;

    const [entries, total] = await Promise.all([
      prisma.auditTrail.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.auditTrail.count({ where }),
    ]);

    res.json({
      entries,
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

// GET /api/audit/:id - Get audit entry by ID
const getAuditEntryById = async (req, res) => {
  try {
    const entry = await prisma.auditTrail.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!entry) return res.status(404).json({ error: 'Audit entry not found' });

    res.json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/audit - Create audit entry (internal use)
const createAuditEntry = async (data) => {
  try {
    const { user_id, entity_type, entity_id, action, description, ip_address } = data;

    await prisma.auditTrail.create({
      data: {
        user_id,
        entity_type,
        entity_id,
        action,
        description,
        ip_address,
      },
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
};

// GET /api/audit/stats - Get audit statistics
const getAuditStats = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const where = {};
    if (start_date) where.created_at = { ...where.created_at, gte: new Date(start_date) };
    if (end_date) where.created_at = { ...where.created_at, lte: new Date(end_date) };

    const [
      totalEntries,
      byAction,
      byEntityType,
      byUser,
    ] = await Promise.all([
      prisma.auditTrail.count({ where }),
      prisma.auditTrail.groupBy({
        by: ['action'],
        _count: true,
        where,
      }),
      prisma.auditTrail.groupBy({
        by: ['entity_type'],
        _count: true,
        where,
      }),
      prisma.auditTrail.groupBy({
        by: ['user_id'],
        _count: true,
        where,
      }),
    ]);

    res.json({
      total_entries: totalEntries,
      by_action: byAction,
      by_entity_type: byEntityType,
      by_user: byUser,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAuditTrail,
  getAuditEntryById,
  createAuditEntry,
  getAuditStats,
};
