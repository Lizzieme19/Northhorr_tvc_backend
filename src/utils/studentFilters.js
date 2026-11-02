const prisma = require('../config/db');

const STUDENT_STATUSES = ['ACTIVE', 'DEFERRED', 'GRADUATED', 'WITHDRAWN', 'ATTACHMENT'];
const INTAKES = ['JANUARY', 'MAY', 'SEPTEMBER'];
const BALANCE_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'];

// page / limit from a query string, with sane bounds
const parsePaging = (query, { defaultLimit = 20, maxLimit = 100 } = {}) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

// Filters on the student record itself. Shared by the student lists, finance list and reports.
//   department_id, course_id, level, intake, year, status, gender, helb, search,
//   term_id (enrolled in that term), has_term ('true' | 'false')
const buildStudentWhere = (q) => {
  const where = {};
  if (q.department_id) where.department_id = q.department_id;
  if (q.course_id) where.course_id = q.course_id;
  if (q.level) where.level = q.level;
  if (q.intake && INTAKES.includes(String(q.intake).toUpperCase())) where.intake = String(q.intake).toUpperCase();
  if (q.year && !isNaN(parseInt(q.year))) where.year = parseInt(q.year);
  if (q.status && STUDENT_STATUSES.includes(String(q.status).toUpperCase())) where.status = String(q.status).toUpperCase();
  if (q.helb === 'true') where.helb_applied = true;
  if (q.helb === 'false') where.helb_applied = false;

  if (q.term_id) where.student_balances = { some: { term_id: q.term_id } };
  else if (q.has_term === 'true') where.student_balances = { some: {} };
  else if (q.has_term === 'false') where.student_balances = { none: {} };

  const and = [];
  if (q.gender) and.push({ application: { gender: { equals: q.gender, mode: 'insensitive' } } });
  if (q.search && String(q.search).trim()) {
    const s = String(q.search).trim();
    and.push({
      OR: [
        { admission_no: { contains: s, mode: 'insensitive' } },
        { application: { surname: { contains: s, mode: 'insensitive' } } },
        { application: { other_names: { contains: s, mode: 'insensitive' } } },
        { application: { phone: { contains: s, mode: 'insensitive' } } },
        { application: { id_number: { contains: s, mode: 'insensitive' } } },
        { user: { email: { contains: s, mode: 'insensitive' } } },
      ],
    });
  }
  if (and.length) where.AND = and;
  return where;
};

// Fee-based filters: fee_status (PENDING | PARTIAL | PAID | OVERDUE), outstanding_only, term_id.
// Returns the ids of matching students, or null when no fee filter is in use.
//
// Across terms a student's status is judged on what they owe overall (billed minus paid), because
// older term rows keep their own balance when debt is carried forward. For one term the row's own
// figures are used.
const resolveFeeFilterIds = async (q) => {
  const status = q.fee_status && BALANCE_STATUSES.includes(String(q.fee_status).toUpperCase())
    ? String(q.fee_status).toUpperCase() : null;
  const outstandingOnly = q.outstanding_only === 'true';
  if (!status && !outstandingOnly) return null;

  if (q.term_id) {
    const rows = await prisma.studentBalance.findMany({
      where: { term_id: q.term_id, ...(status && { status }), ...(outstandingOnly && { balance: { gt: 0 } }) },
      select: { student_id: true },
    });
    return [...new Set(rows.map((r) => r.student_id))];
  }

  if (status === 'OVERDUE') {
    const rows = await prisma.studentBalance.findMany({ where: { status: 'OVERDUE' }, select: { student_id: true } });
    return [...new Set(rows.map((r) => r.student_id))];
  }

  const sums = await prisma.studentBalance.groupBy({ by: ['student_id'], _sum: { total_fees: true, amount_paid: true } });
  return sums
    .filter((s) => {
      const fees = s._sum.total_fees || 0;
      const paid = s._sum.amount_paid || 0;
      const owing = fees - paid;
      if (outstandingOnly && owing <= 0.01) return false;
      if (status === 'PAID') return fees > 0 && owing <= 0.01;
      if (status === 'PARTIAL') return paid > 0 && owing > 0.01;
      if (status === 'PENDING') return paid <= 0 && owing > 0.01;
      return true;
    })
    .map((s) => s.student_id);
};

module.exports = { STUDENT_STATUSES, INTAKES, BALANCE_STATUSES, parsePaging, buildStudentWhere, resolveFeeFilterIds };
