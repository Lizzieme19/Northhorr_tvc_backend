const prisma = require('../config/db');
const { reconcileMany } = require('./billingService');

// ─────────────────────────────────────────────────────────────────────────────
// Kinds of student: who has which, and moving a student to another kind. The fees themselves are worked out by the
// billing engine (billingService), which reads these types.
// ─────────────────────────────────────────────────────────────────────────────

// The type a new student starts with: the one named like how they applied (KUCCPS, Direct), else the default.
// With no types set up it is null, and fees work as they always have.
const typeIdForApplication = async (applicationType) => {
  const types = await prisma.studentType.findMany({ where: { is_active: true } });
  if (!types.length) return null;
  const named = types.find((t) => String(t.name).toLowerCase() === String(applicationType || '').toLowerCase());
  return (named || types.find((t) => t.is_default) || null)?.id || null;
};

// The term a change of type starts from when none is chosen: the term running now, else the latest one that has started
const defaultFromTerm = async () => {
  const now = new Date();
  const terms = await prisma.term.findMany({ orderBy: { start_date: 'desc' } });
  return terms.find((t) => new Date(t.start_date) <= now && new Date(t.end_date) >= now) || terms.find((t) => new Date(t.start_date) <= now) || null;
};

// Move students to a kind of student, from a term onward. Terms before it stay billed as they were.
// apply=false only reports what would change.
const assignType = async (studentIds, typeId, { fromTerm = null, apply = false } = {}) => {
  const type = await prisma.studentType.findUnique({ where: { id: typeId } });
  if (!type) throw Object.assign(new Error('Student type not found'), { status: 404 });
  if (!type.is_active) throw Object.assign(new Error('That student type is switched off'), { status: 400 });
  const defaultType = await prisma.studentType.findFirst({ where: { is_default: true } });
  const from = fromTerm || (await defaultFromTerm());
  const fromStart = from ? new Date(from.start_date) : new Date(0);

  const impact = await reconcileMany(studentIds, { apply: false, typeChange: { typeId, fromStart }, limitItems: 200 });
  if (!apply) return { type, from_term: from ? { id: from.id, name: from.name, academic_year: from.academic_year } : null, students: studentIds.length, impact, applied: false };

  let moved = 0;
  for (const id of studentIds) {
    const student = await prisma.student.findUnique({ where: { id }, select: { id: true, student_type_id: true } });
    if (!student) continue;
    const oldId = student.student_type_id || defaultType?.id || null;
    const rows = await prisma.studentBalance.findMany({ where: { student_id: id }, include: { term: { select: { start_date: true } } } });
    for (const r of rows) {
      const starts = new Date(r.term.start_date);
      if (starts >= fromStart) {
        await prisma.studentBalance.update({ where: { id: r.id }, data: { student_type_id: typeId } });
      } else if (!r.student_type_id && oldId) {
        // an earlier term keeps the kind it was billed as
        await prisma.studentBalance.update({ where: { id: r.id }, data: { student_type_id: oldId } });
      }
    }
    await prisma.student.update({ where: { id }, data: { student_type_id: typeId } });
    moved += 1;
  }
  const applied = await reconcileMany(studentIds, { apply: true, limitItems: 200 });
  return { type, from_term: from ? { id: from.id, name: from.name, academic_year: from.academic_year } : null, students: moved, impact: applied, applied: true };
};

// The type chosen on approval, checked; with none chosen it follows how the applicant applied
const typeIdForApproval = async (explicitId, applicationType) => {
  if (explicitId) {
    const t = await prisma.studentType.findUnique({ where: { id: explicitId } });
    if (!t) throw Object.assign(new Error('That student type was not found'), { status: 400 });
    if (!t.is_active) throw Object.assign(new Error(`${t.name} is switched off`), { status: 400 });
    return t.id;
  }
  return typeIdForApplication(applicationType);
};

module.exports = { typeIdForApplication, typeIdForApproval, defaultFromTerm, assignType };
