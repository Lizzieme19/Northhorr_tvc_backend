const prisma = require('../config/db');
const { summarizeBalances, round2 } = require('../utils/feeTotals');
const { buildTimeline } = require('./studentProgressionService');
const { normalizeKenyaPhone } = require('../utils/kenyaPhone');

// ─────────────────────────────────────────────────────────────────────────────
// LINKED ADMISSIONS
// One person can have several admissions (Level 5, then Level 6, perhaps another course). Each admission stays its own
// student record with its own admission number, course, level, intake, dates, status, bills, payments and documents.
// Linking only makes them share ONE login: the primary record owns the login, the others point at it. Nothing is
// moved or deleted, so a link made in error is undone by unlinking.
// ─────────────────────────────────────────────────────────────────────────────

const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });

const fullInclude = {
  user: { select: { id: true, email: true, is_active: true } },
  application: true,
  course: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  student_balances: { include: { term: { select: { id: true, name: true, academic_year: true, start_date: true } } } },
  documents: { select: { id: true } },
  linked_admissions: { select: { id: true, admission_no: true } },
  primary_student: { select: { id: true, admission_no: true } },
};

// ── tidy values so "Roba  Buke" and "buke roba" compare as the same ──
const norm = {
  name: (a) => [a?.surname, a?.other_names].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' '),
  dob: (a) => (a?.date_of_birth ? new Date(a.date_of_birth).toISOString().slice(0, 10) : ''),
  text: (v) => String(v ?? '').trim().toLowerCase(),
  code: (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  phone: (v) => normalizeKenyaPhone(v) || String(v ?? '').replace(/\D/g, ''),
  email: (v) => String(v ?? '').trim().toLowerCase(),
};

const DETAILS = [
  { key: 'name', label: 'Name', get: (a) => norm.name(a), show: (a) => [a?.surname, a?.other_names].filter(Boolean).join(' ') },
  { key: 'date_of_birth', label: 'Date of birth', get: norm.dob, show: norm.dob },
  { key: 'gender', label: 'Gender', get: (a) => norm.text(a?.gender), show: (a) => a?.gender || '' },
  { key: 'id_number', label: 'ID number', get: (a) => norm.code(a?.id_number), show: (a) => a?.id_number || '' },
  { key: 'birth_cert_no', label: 'Birth certificate no.', get: (a) => norm.code(a?.birth_cert_no), show: (a) => a?.birth_cert_no || '' },
  { key: 'phone', label: 'Phone', get: (a) => norm.phone(a?.phone), show: (a) => a?.phone || '' },
  { key: 'email', label: 'Email', get: (a) => norm.email(a?.email), show: (a) => a?.email || '' },
  { key: 'nationality', label: 'Nationality', get: (a) => norm.text(a?.nationality), show: (a) => a?.nationality || '' },
];

const termLabel = (t) => (t ? `${t.name} (${t.academic_year})` : 'a term');

const summary = (s, withMoney) => {
  const a = s.application || {};
  const money = summarizeBalances(s.student_balances);
  return {
    id: s.id,
    admission_no: s.admission_no,
    name: [a.surname, a.other_names].filter(Boolean).join(' '),
    course: s.course?.name || null,
    department: s.department?.name || null,
    level: s.level,
    intake: s.intake,
    year: s.year,
    status: s.status,
    admitted_on: s.created_at,
    login_email: s.user?.email || null,
    terms_billed: s.student_balances.length,
    documents: s.documents.length,
    linked_to: s.primary_student ? s.primary_student.admission_no : null,
    has_linked_admissions: s.linked_admissions.length > 0,
    ...(withMoney ? { billed: money.totalFees, paid: money.totalPaid, outstanding: money.outstanding } : {}),
  };
};

// What would linking `otherId` under `primaryId` do, and is it safe? Writes nothing.
const previewLink = async (primaryId, otherId, { withMoney = true } = {}) => {
  if (!otherId) throw fail('Choose the other admission to link');
  if (primaryId === otherId) throw fail('Choose two different admissions');
  const [p, o] = await Promise.all([
    prisma.student.findUnique({ where: { id: primaryId }, include: fullInclude }),
    prisma.student.findUnique({ where: { id: otherId }, include: fullInclude }),
  ]);
  if (!p || !o) throw fail('Student not found', 404);

  const blockers = [];
  if (p.primary_student) blockers.push(`${p.admission_no} is itself linked under ${p.primary_student.admission_no}. Open ${p.primary_student.admission_no} to link another admission, or unlink it first.`);
  if (o.primary_student) blockers.push(`${o.admission_no} is already linked under ${o.primary_student.admission_no}. Unlink it first if that was a mistake.`);
  if (o.linked_admissions.length) blockers.push(`${o.admission_no} already has other admissions linked to it (${o.linked_admissions.map((x) => x.admission_no).join(', ')}). Unlink them first, or link this admission under that record instead.`);

  // Details that are filled in on both records and disagree
  const differences = [];
  const same = [];
  for (const d of DETAILS) {
    const pv = d.get(p.application); const ov = d.get(o.application);
    if (!pv || !ov) continue;
    if (pv !== ov) differences.push({ field: d.key, label: d.label, primary: d.show(p.application), other: d.show(o.application) });
    else if (['id_number', 'birth_cert_no', 'email', 'name'].includes(d.key)) same.push(d.key);
  }
  const signals = [];
  if (same.includes('id_number')) signals.push('Same ID number');
  if (same.includes('birth_cert_no')) signals.push('Same birth certificate number');
  if (same.includes('email')) signals.push('Same email address');
  if (same.includes('name') && norm.dob(p.application) && norm.dob(p.application) === norm.dob(o.application)) signals.push('Same name and date of birth');

  // Bills in the same term on both admissions
  const overlaps = [];
  for (const ob of o.student_balances) {
    const pb = p.student_balances.find((b) => b.term_id === ob.term_id);
    if (pb) overlaps.push({ term: termLabel(ob.term), primary_billed: withMoney ? pb.total_fees : undefined, other_billed: withMoney ? ob.total_fees : undefined });
  }

  const warnings = [];
  if (signals.length === 0) warnings.push('Nothing on the two records says they are the same person (no matching ID number, birth certificate, email, or name with date of birth). Check before linking.');
  if (p.course_id === o.course_id && String(p.level).toLowerCase() === String(o.level).toLowerCase()) warnings.push('Both are the same course and level. That looks like a duplicate entry rather than a progression to a higher level.');
  if (overlaps.length) warnings.push(`Both admissions are billed for the same term${overlaps.length === 1 ? '' : 's'}: ${overlaps.map((x) => x.term).join(', ')}. Their bills stay separate, so the person will be billed twice for that time.`);
  if (differences.length) warnings.push('Some details differ between the two records. The login and profile use the details on the record that keeps the login.');

  return {
    primary: summary(p, withMoney),
    other: summary(o, withMoney),
    same_person_signals: signals,
    differences,
    overlaps,
    warnings,
    blockers,
    can_link: blockers.length === 0,
    needs_acknowledgement: blockers.length === 0 && warnings.length > 0,
  };
};

const audit = (meta, { action, entityId, oldValues, newValues }) =>
  prisma.auditTrail.create({
    data: {
      user_id: meta.userId, action, entity_type: 'STUDENT', entity_id: entityId || null,
      old_values: oldValues ? JSON.stringify(oldValues) : null, new_values: newValues ? JSON.stringify(newValues) : null,
      ip_address: meta.ip || null, user_agent: meta.userAgent || null,
    },
  }).catch((e) => console.error('audit failed', e.message));

// Link `otherId` under `primaryId`: both stay as they are; `otherId` uses the login of `primaryId` from now on
const linkAdmissions = async (primaryId, otherId, meta, { acknowledge = false } = {}) => {
  const preview = await previewLink(primaryId, otherId);
  if (!preview.can_link) throw fail(preview.blockers[0], 400, { preview });
  if (preview.needs_acknowledgement && !acknowledge) throw fail('Please read the warnings and confirm to link these admissions', 409, { code: 'NEEDS_ACKNOWLEDGEMENT', preview });

  const other = await prisma.student.findUnique({ where: { id: otherId }, include: { user: { select: { id: true, is_active: true } } } });
  const writes = [
    prisma.student.update({
      where: { id: otherId },
      data: { primary_student_id: primaryId, linked_at: new Date(), linked_by: meta.userId, link_parked_login: Boolean(other.user?.is_active) },
    }),
    prisma.refreshToken.deleteMany({ where: { user_id: other.user_id } }),
  ];
  // the other admission's own login is switched off (and switched back on if the link is undone)
  if (other.user?.is_active) writes.push(prisma.user.update({ where: { id: other.user_id }, data: { is_active: false } }));
  await prisma.$transaction(writes);

  await audit(meta, {
    action: 'ADMISSIONS_LINKED', entityId: primaryId,
    newValues: { login_kept_by: preview.primary.admission_no, linked: preview.other.admission_no, acknowledged_warnings: preview.warnings },
  });
  return { primary: preview.primary.admission_no, linked: preview.other.admission_no };
};

// Undo a link: the admission gets its own login back exactly as it was
const unlinkAdmission = async (studentId, meta) => {
  const s = await prisma.student.findUnique({ where: { id: studentId }, include: { primary_student: { select: { admission_no: true } } } });
  if (!s) throw fail('Student not found', 404);
  if (!s.primary_student_id) throw fail('This admission is not linked to another one');
  const writes = [
    prisma.student.update({ where: { id: studentId }, data: { primary_student_id: null, linked_at: null, linked_by: null, link_parked_login: false } }),
  ];
  if (s.link_parked_login) writes.push(prisma.user.update({ where: { id: s.user_id }, data: { is_active: true } }));
  await prisma.$transaction(writes);
  await audit(meta, { action: 'ADMISSIONS_UNLINKED', entityId: s.primary_student_id, oldValues: { was_linked_under: s.primary_student?.admission_no, admission: s.admission_no } });
  return { admission_no: s.admission_no, was_linked_under: s.primary_student?.admission_no || null };
};

// The login owner and the other admissions that share its login, login owner first
const groupMembers = async (studentId, include = fullInclude) => {
  const s = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, primary_student_id: true } });
  if (!s) throw fail('Student not found', 404);
  const primaryId = s.primary_student_id || s.id;
  const members = await prisma.student.findMany({
    where: { OR: [{ id: primaryId }, { primary_student_id: primaryId }] },
    include,
    orderBy: { created_at: 'asc' },
  });
  return members.sort((a, b) => (a.id === primaryId ? -1 : b.id === primaryId ? 1 : 0));
};

// Is `studentId` one of the admissions that share this student's login? (for a student reading their own records)
const inOwnGroup = async (ownStudentId, studentId) => {
  if (ownStudentId === studentId) return true;
  const t = await prisma.student.findUnique({ where: { id: studentId }, select: { primary_student_id: true } });
  return Boolean(t && t.primary_student_id === ownStudentId);
};

// Every stage of every admission in one timeline. Each admission keeps its own dates and status.
const combinedHistory = async (studentId) => {
  const members = await groupMembers(studentId, {
    course: { select: { name: true } },
    student_balances: { select: { level: true, term: { select: { name: true, academic_year: true, start_date: true } } } },
    progressions: { include: { term: { select: { name: true, academic_year: true, start_date: true } }, promoter: { select: { email: true } } } },
  });
  const stages = [];
  for (const m of members) {
    for (const st of buildTimeline(m, m.progressions, m.student_balances)) {
      stages.push({ ...st, admission_id: m.id, admission_status: m.status, is_login_owner: m.id === members[0].id });
    }
  }
  stages.sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  return { stages, admissions: members.length };
};

// A fee statement across every admission, with each admission's own bills and payments kept separate
const statementFor = async (studentId) => {
  const members = await groupMembers(studentId, {
    course: { select: { name: true } },
    user: { select: { email: true } },
    student_balances: { include: { term: { select: { name: true, academic_year: true, start_date: true } } } },
    fee_records: { include: { feeType: { select: { name: true } }, term: { select: { name: true, academic_year: true } } }, orderBy: { paid_at: 'asc' } },
  });
  const admissions = members.map((m) => {
    const rows = [...m.student_balances].sort((a, b) => new Date(a.term.start_date) - new Date(b.term.start_date));
    const money = summarizeBalances(rows);
    return {
      id: m.id, admission_no: m.admission_no, course: m.course?.name || null, level: m.level, intake: m.intake, year: m.year, status: m.status,
      is_login_owner: m.id === members[0].id,
      billed: money.totalFees, paid: money.totalPaid, outstanding: money.outstanding,
      terms: rows.map((b) => ({
        term: `${b.term.name} (${b.term.academic_year})`, level: b.level, billed: b.total_fees, carried_forward: b.previous_balance_carryover,
        paid: b.amount_paid, balance: b.balance, status: b.status,
      })),
      payments: m.fee_records.map((f) => ({ paid_at: f.paid_at, amount: f.amount, fee_type: f.feeType?.name || null, term: f.term ? `${f.term.name} (${f.term.academic_year})` : null, reference: f.reference_code || null })),
    };
  });
  return {
    admissions,
    combined: {
      billed: round2(admissions.reduce((s, a) => s + a.billed, 0)),
      paid: round2(admissions.reduce((s, a) => s + a.paid, 0)),
      outstanding: round2(admissions.reduce((s, a) => s + a.outstanding, 0)),
    },
  };
};

module.exports = { previewLink, linkAdmissions, unlinkAdmission, groupMembers, inOwnGroup, combinedHistory, statementFor };
