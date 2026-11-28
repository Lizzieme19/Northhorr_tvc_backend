const prisma = require('../config/db');

// Changing a student's email (Admin / Registrar). The email is what the student signs in with, so the login and the
// student's record are changed together. Linked admissions share one login: whichever admission is being edited, it is
// that shared login that changes.

const fail = (message, status = 400) => Object.assign(new Error(message), { status, fields: { email: message } });
const lower = (v) => String(v ?? '').trim().toLowerCase();

// Checks the new email and works out what has to be written, without writing. Returns null when nothing changes.
const planEmailChange = async (studentId, raw) => {
  const email = lower(raw);
  if (!email) throw fail('A student needs an email address: it is used to sign in');
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('That does not look like an email address');

  const include = { user: { select: { id: true, email: true, role: true } }, application: { select: { id: true, email: true } } };
  const student = await prisma.student.findUnique({ where: { id: studentId }, include });
  if (!student) throw fail('Student not found', 404);

  // every admission of this person; the one the others are linked to owns the shared login
  const ownerId = student.primary_student_id || student.id;
  const admissions = await prisma.student.findMany({ where: { OR: [{ id: ownerId }, { primary_student_id: ownerId }] }, include });
  const owner = admissions.find((a) => a.id === ownerId) || student;
  const login = owner.user;
  // never a staff account: this must not be a way to take over someone else's sign-in
  if (login.role !== 'STUDENT') throw fail('This record signs in with a staff account. Change it under Users.', 403);

  const old = login.email;
  const records = admissions.filter((a) => a.application && (a.id === student.id || a.id === owner.id || lower(a.application.email) === lower(old)));
  const recordsToChange = records.filter((a) => a.application.email !== email);
  if (email === old && !recordsToChange.length) return null;

  // someone else's email cannot be taken. One of this student's own linked logins can: the two swap places.
  let swap = null;
  const clash = email === old ? null : await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, NOT: { id: login.id } } });
  if (clash) {
    swap = admissions.find((a) => a.id !== owner.id && a.user.id === clash.id) || null;
    if (!swap) {
      const other = await prisma.student.findUnique({ where: { user_id: clash.id }, select: { admission_no: true } });
      throw fail(`That email is already used by ${other ? `student ${other.admission_no}` : 'another account'}`, 409);
    }
  }

  const writes = () => {
    const ops = [];
    // free the address first, then hand the old one to the linked login that gave it up
    if (swap) ops.push(prisma.user.update({ where: { id: swap.user.id }, data: { email: `moving+${swap.user.id}@invalid.local` } }));
    if (email !== old) ops.push(prisma.user.update({ where: { id: login.id }, data: { email } }));
    if (swap) ops.push(prisma.user.update({ where: { id: swap.user.id }, data: { email: old } }));
    for (const a of recordsToChange) ops.push(prisma.application.update({ where: { id: a.application.id }, data: { email: swap && a.id === swap.id ? old : email } }));
    return ops;
  };

  return { student_id: student.id, admission_no: student.admission_no, old, email, shared: admissions.length > 1, writes };
};

const applyEmailChange = async (plan, req) => {
  try {
    await prisma.$transaction(plan.writes());
  } catch (err) {
    if (err.code === 'P2002') throw fail('That email is already used by another account', 409);
    throw err;
  }
  await prisma.auditTrail.create({
    data: {
      user_id: req.user.id, action: 'STUDENT_EMAIL_CHANGED', entity_type: 'STUDENT', entity_id: plan.student_id,
      old_values: JSON.stringify({ email: plan.old }), new_values: JSON.stringify({ email: plan.email, admission_no: plan.admission_no }),
      ip_address: req.ip || null, user_agent: req.headers?.['user-agent'] || null,
    },
  }).catch((e) => console.error('audit failed', e.message));
};

module.exports = { planEmailChange, applyEmailChange };
