const prisma = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// The activity log. Records what signed-in people do: every create, change and delete, every sign-in (and failed
// sign-in), and downloads/exports of reports and documents. Plain reading of lists is not logged (it would drown
// the useful entries). A log entry is written after the request has finished and can never make a request fail.
// Passwords, tokens and secrets are never stored.
// ─────────────────────────────────────────────────────────────────────────────

const HIDDEN = /pass|token|secret|authorization|cookie|otp|pin$|key$|credential/i;
const MAX_VALUE = 400;
const MAX_BODY = 4000;

// Copy of a value that is safe to keep: secrets replaced, long text cut, depth limited
const redact = (v, depth = 0) => {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}… (${v.length} characters)` : v;
  if (typeof v !== 'object') return v;
  if (depth >= 4) return '[nested]';
  if (Array.isArray(v)) return v.slice(0, 25).map((x) => redact(x, depth + 1)).concat(v.length > 25 ? [`… ${v.length - 25} more`] : []);
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = HIDDEN.test(k) ? '[hidden]' : redact(val, depth + 1);
  return out;
};

const bodyText = (body, files) => {
  const safe = body && typeof body === 'object' && Object.keys(body).length ? redact(body) : {};
  if (files && files.length) safe._files = files;
  if (Object.keys(safe).length === 0) return null;
  const t = JSON.stringify(safe);
  return t.length > MAX_BODY ? `${t.slice(0, MAX_BODY)}…[cut]` : t;
};

const clientIp = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  const first = fwd ? String(fwd).split(',')[0].trim() : null;
  return (first || req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// first path word after /api -> what the entry is about
const ENTITY = {
  students: 'STUDENT', applications: 'APPLICATION', 'student-documents': 'STUDENT_DOCUMENT', finance: 'FINANCE', fees: 'FEE', 'fee-types': 'FEE_TYPE',
  terms: 'TERM', 'term-progression': 'TERM_PROGRESSION', courses: 'COURSE', departments: 'DEPARTMENT', staff: 'STAFF', designations: 'DESIGNATION',
  leaves: 'LEAVE', suppliers: 'SUPPLIER', requisitions: 'REQUISITION', rfqs: 'RFQ', lpos: 'LPO', grns: 'GRN', inventory: 'INVENTORY', invoices: 'INVOICE',
  assets: 'ASSET', budgets: 'BUDGET', audit: 'AUDIT', resources: 'RESOURCE', news: 'NEWS', gallery: 'GALLERY', contact: 'CONTACT',
  'document-templates': 'DOCUMENT_TEMPLATE', settings: 'SETTING', auth: 'AUTH', users: 'USER',
};
const LABEL = (e) => e.toLowerCase().replace(/_/g, ' ');

const parsePath = (url) => {
  const path = String(url).split('?')[0];
  const parts = path.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const entity = ENTITY[parts[0]] || (parts[0] ? parts[0].toUpperCase().replace(/-/g, '_') : 'OTHER');
  const id = parts.find((p) => UUID.test(p)) || null;
  const words = parts.slice(1).filter((p) => !UUID.test(p) && !/^\d+$/.test(p));
  return { path, entity, id, words };
};

const VERB = { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE', GET: 'DOWNLOAD' };
const PAST = { CREATE: 'Created', UPDATE: 'Updated', DELETE: 'Deleted', DOWNLOAD: 'Downloaded' };

// a sentence for the screen: "Updated requisition: approve"
const SPECIAL = [
  [/^\/api\/auth\/change-password$/, 'Changed own password'],
  [/^\/api\/auth\/create-staff$/, 'Created a staff account'],
  [/\/payments?(\/|$)/, 'Recorded or changed a payment'],
  [/^\/api\/students\/import/, 'Imported students from a spreadsheet'],
  [/^\/api\/assets\/import/, 'Imported the asset registers workbook'],
];
const describe = (method, entity, words, action, path = '') => {
  const special = SPECIAL.find(([re]) => re.test(path));
  if (special && action !== 'DOWNLOAD') return special[1];
  const base = `${PAST[action] || action} ${LABEL(entity)}`;
  const extra = words.filter((w) => !['students', 'terms', 'all'].includes(w)).slice(-2).join(' ');
  return extra ? `${base}: ${extra.replace(/-/g, ' ')}` : base;
};

// Writes one entry. Never throws.
const record = async (e) => {
  try {
    await prisma.auditTrail.create({ data: e });
  } catch (err) {
    console.error('Activity log write failed:', err.message);
  }
};

// For explicit events (sign-in, failed sign-in, sign-out, password change)
const logEvent = (req, { user, actor, action, summary, entity_type = 'AUTH', status_code = null }) =>
  record({
    user_id: user?.id || null,
    actor: actor || user?.email || null,
    role: user?.role || null,
    action,
    summary,
    entity_type,
    entity_id: user?.id || null,
    method: req.method,
    path: String(req.originalUrl || '').split('?')[0],
    status_code,
    ip_address: clientIp(req),
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
  });

// Express middleware: log what a request did once it has finished
const middleware = (req, res, next) => {
  const url = req.originalUrl || '';
  if (!url.startsWith('/api/')) return next();
  const started = Date.now();
  res.on('finish', () => {
    try {
      const { path, entity, id, words } = parsePath(url);
      // sign-in, refresh and sign-out are logged by the auth code itself
      if (/^\/api\/auth\/(login|refresh|logout)$/.test(path)) return;
      const reading = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      const isDownload = reading && /\/(pdf|export|download|id-card)(\/|$)|\/reports\//.test(path);
      if (reading && !isDownload) return;
      if (!req.user && (res.statusCode < 200 || res.statusCode >= 300)) return; // anonymous noise (bots, probes)
      const action = isDownload ? 'DOWNLOAD' : VERB[req.method] || req.method;
      const files = []
        .concat(req.file ? [req.file] : [], Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat())
        .map((f) => f.originalname).filter(Boolean);
      record({
        user_id: req.user?.id || null,
        actor: req.user?.email || (req.user ? null : 'Public visitor'),
        role: req.user?.role || null,
        action,
        summary: res.statusCode < 400
          ? describe(req.method, entity, words, action, path)
          : `Tried to ${action.toLowerCase()} ${LABEL(entity)}: ${res.statusCode === 401 || res.statusCode === 403 ? 'not allowed' : 'failed'} (${res.statusCode})`,
        entity_type: entity,
        entity_id: id,
        method: req.method,
        path,
        status_code: res.statusCode,
        duration_ms: Date.now() - started,
        // what was sent: kept for signed-in people only (a public form holds personal details)
        new_values: req.user ? bodyText(req.body, files) : null,
        ip_address: clientIp(req),
        user_agent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
      });
    } catch (err) {
      console.error('Activity log failed:', err.message);
    }
  });
  next();
};

module.exports = { middleware, logEvent, record, redact, clientIp, parsePath, describe };
