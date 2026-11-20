const XLSX = require('xlsx');
const prisma = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// The activity log screen (Admin only). Entries are written by services/activityLog.js and are never changed or
// removed here.
// ─────────────────────────────────────────────────────────────────────────────

const userSelect = { select: { id: true, email: true, role: true } };

// Filters shared by the list, the export and the counts
const buildWhere = (q) => {
  const where = {};
  if (q.user_id) where.user_id = q.user_id;
  if (q.role) where.role = q.role;
  if (q.action) where.action = q.action;
  if (q.entity_type) where.entity_type = q.entity_type;
  if (q.method) where.method = q.method;
  if (q.outcome === 'failed') where.OR = [{ status_code: { gte: 400 } }, { action: 'LOGIN_FAILED' }];
  if (q.outcome === 'ok') where.AND = [{ OR: [{ status_code: null }, { status_code: { lt: 400 } }] }, { NOT: { action: 'LOGIN_FAILED' } }];
  if (q.from || q.to) {
    where.created_at = {};
    if (q.from) where.created_at.gte = new Date(`${q.from}T00:00:00.000Z`);
    if (q.to) where.created_at.lte = new Date(`${q.to}T23:59:59.999Z`);
  }
  if (q.search) {
    const s = String(q.search).trim();
    if (s) {
      const text = [{ actor: { contains: s, mode: 'insensitive' } }, { summary: { contains: s, mode: 'insensitive' } }, { path: { contains: s, mode: 'insensitive' } }, { ip_address: { contains: s } }, { entity_id: { contains: s } }];
      where.AND = [...(where.AND || []), { OR: text }];
    }
  }
  return where;
};

// GET /api/audit
const getAuditTrail = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const where = buildWhere(req.query);
    const [entries, total] = await Promise.all([
      prisma.auditTrail.findMany({ where, include: { user: userSelect }, orderBy: { created_at: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.auditTrail.count({ where }),
    ]);
    res.json({ entries, pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/audit/filters - values for the filter boxes, and who has been active
const getAuditFilters = async (req, res) => {
  try {
    const [actions, entities, roles, users, failed24h, total] = await Promise.all([
      prisma.auditTrail.groupBy({ by: ['action'], _count: true }),
      prisma.auditTrail.groupBy({ by: ['entity_type'], _count: true }),
      prisma.auditTrail.groupBy({ by: ['role'], _count: true, where: { role: { not: null } } }),
      prisma.auditTrail.groupBy({ by: ['user_id', 'actor'], _count: true, where: { user_id: { not: null } } }),
      prisma.auditTrail.count({ where: { created_at: { gte: new Date(Date.now() - 24 * 3600 * 1000) }, OR: [{ status_code: { gte: 400 } }, { action: 'LOGIN_FAILED' }] } }),
      prisma.auditTrail.count(),
    ]);
    res.json({
      total,
      failed_last_24h: failed24h,
      actions: actions.map((a) => ({ value: a.action, count: a._count })).sort((a, b) => b.count - a.count),
      entity_types: entities.map((a) => ({ value: a.entity_type, count: a._count })).sort((a, b) => b.count - a.count),
      roles: roles.map((a) => ({ value: a.role, count: a._count })),
      users: users.map((u) => ({ id: u.user_id, email: u.actor, count: u._count })).sort((a, b) => String(a.email).localeCompare(String(b.email))),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/audit/export - the filtered entries as an Excel file (up to 20,000 rows)
const exportAuditTrail = async (req, res) => {
  try {
    const rows = await prisma.auditTrail.findMany({ where: buildWhere(req.query), include: { user: userSelect }, orderBy: { created_at: 'desc' }, take: 20000 });
    const sheet = XLSX.utils.json_to_sheet(rows.map((r) => ({
      'Date and time': r.created_at.toISOString().replace('T', ' ').slice(0, 19),
      Who: r.user?.email || r.actor || '',
      Role: r.role || r.user?.role || '',
      Action: r.action,
      What: r.summary || '',
      About: r.entity_type,
      'Record id': r.entity_id || '',
      Method: r.method || '',
      Address: r.path || '',
      Result: r.status_code ?? '',
      'IP address': r.ip_address || '',
      Details: r.new_values || '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Activity log');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Activity_log_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not export the activity log' });
  }
};

// GET /api/audit/:id
const getAuditEntryById = async (req, res) => {
  try {
    const entry = await prisma.auditTrail.findUnique({ where: { id: req.params.id }, include: { user: userSelect } });
    if (!entry) return res.status(404).json({ error: 'Audit entry not found' });
    res.json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/audit/stats
const getAuditStats = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const where = {};
    if (start_date) where.created_at = { ...where.created_at, gte: new Date(start_date) };
    if (end_date) where.created_at = { ...where.created_at, lte: new Date(end_date) };
    const [totalEntries, byAction, byEntityType, byUser] = await Promise.all([
      prisma.auditTrail.count({ where }),
      prisma.auditTrail.groupBy({ by: ['action'], _count: true, where }),
      prisma.auditTrail.groupBy({ by: ['entity_type'], _count: true, where }),
      prisma.auditTrail.groupBy({ by: ['user_id'], _count: true, where }),
    ]);
    res.json({ total_entries: totalEntries, by_action: byAction, by_entity_type: byEntityType, by_user: byUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Older code can still add an entry this way
const createAuditEntry = async ({ user_id, entity_type, entity_id, action, description, ip_address }) => {
  try {
    await prisma.auditTrail.create({ data: { user_id, entity_type, entity_id, action, summary: description, ip_address } });
  } catch (err) {
    console.error('Audit log error:', err);
  }
};

module.exports = { getAuditTrail, getAuditFilters, exportAuditTrail, getAuditEntryById, getAuditStats, createAuditEntry };
