const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { summarizeBalances, round2 } = require('../utils/feeTotals');
const { statusFor } = require('./billingService');
const { getMonthShortcode } = require('../utils/admissionNumberGenerator');

// ─────────────────────────────────────────────────────────────────────────────
// RESTORE A MERGED ADMISSION
// The older "Link Earlier Record" folded one admission into another and deleted it. Every such merge left a LINKED
// entry in the history, the older admission's own application, and its bills and payments sitting on the kept record
// at the older level. This puts the older admission back as its own record (own admission number, application, bills
// and payments), linked under the current one so they share a login. Preview first; nothing changes until applied.
// ─────────────────────────────────────────────────────────────────────────────

const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const levelKey = (l) => String(l || '').replace(/\s+/g, '').toLowerCase();
const STATUSES = ['GRADUATED', 'WITHDRAWN', 'DEFERRED', 'ACTIVE', 'ATTACHMENT'];
const startOf = (r) => new Date(r.term?.start_date || 0).getTime();

// Carry-forward along one admission's own terms, keeping the billed and paid figures exactly as stored.
// A debt carried in from a term that is no longer on this admission drops away (it stays with the admission it came from).
const chain = (rows) => {
  const sorted = [...rows].sort((a, b) => startOf(a) - startOf(b));
  const out = [];
  sorted.forEach((r, i) => {
    const carry = i > 0 ? out[i - 1].balance : (r.carried_from_term_id ? 0 : round2(r.previous_balance_carryover || 0));
    const paid = round2(r.amount_paid || 0);
    const total = round2(r.total_fees || 0);
    const balance = round2(total + carry - paid);
    out.push({
      id: r.id, term_id: r.term_id, term: r.term, level: r.level,
      total_fees: total, previous_balance_carryover: carry, amount_paid: paid, balance,
      status: statusFor(balance, paid), carried_from_term_id: i > 0 ? sorted[i - 1].term_id : null,
    });
  });
  return out;
};

const loginEmailFor = async (admissionNo) => {
  const base = String(admissionNo).toLowerCase().replace(/[^a-z0-9]/g, '');
  for (let n = 0; n < 50; n += 1) {
    const email = `${base}${n ? n + 1 : ''}@northhorrtvc.ac.ke`;
    if (!(await prisma.user.findUnique({ where: { email } }))) return email;
  }
  throw fail('Could not make a login email for the restored admission');
};

const loadProgression = (id) => prisma.studentProgression.findUnique({
  where: { id },
  include: {
    student: {
      include: {
        application: { select: { surname: true, other_names: true } },
        course: { select: { id: true, name: true } },
        student_balances: { include: { term: true } },
        fee_records: { select: { id: true, term_id: true, amount: true } },
        primary_student: { select: { id: true } },
      },
    },
  },
});

// What restoring this merge would do. Writes nothing.
const planRestore = async (progressionId, { termIds, status } = {}) => {
  const prog = await loadProgression(progressionId);
  if (!prog || prog.kind !== 'LINKED') throw fail('That is not a merged admission', 404);
  const keep = prog.student;
  const blockers = [];
  const warnings = [];

  if (keep.primary_student) blockers.push('The current admission is itself linked under another one. Unlink it first.');
  const oldNo = prog.old_admission_no;
  if (!oldNo) blockers.push('The earlier admission number was not recorded.');
  else if (await prisma.student.findUnique({ where: { admission_no: oldNo } })) blockers.push(`${oldNo} is already in use by a student record, so it may already have been restored.`);
  if (!prog.from_intake || !prog.from_year) blockers.push('The intake and year of the earlier admission were not recorded.');

  // The earlier admission's own application survives, pointing at the record it was folded into
  const orphans = await prisma.application.findMany({ where: { continuing_student_id: keep.id, student: { is: null } } });
  let candidates = orphans.filter((a) => levelKey(a.level_applied) === levelKey(prog.from_level));
  let app = null;
  if (candidates.length === 1) app = candidates[0];
  else if (candidates.length > 1) blockers.push(`More than one application could be the earlier admission's (${candidates.map((a) => a.application_no).join(', ')}). It needs a person to decide.`);
  else if (orphans.length === 1) { app = orphans[0]; warnings.push(`The only application on file (${app.application_no}) is for ${app.level_applied || 'an unrecorded level'}, not ${prog.from_level}. Check it is the right person's.`); }
  else blockers.push('The earlier admission\'s application is not on file, so its details cannot be restored.');

  // Which of the current record's term bills belong to the earlier admission: by default those at the earlier level
  const rows = keep.student_balances;
  let selected;
  if (Array.isArray(termIds)) {
    const have = new Set(rows.map((r) => r.term_id));
    const bad = termIds.filter((t) => !have.has(t));
    if (bad.length) blockers.push('A term chosen is not on this record.');
    selected = new Set(termIds);
  } else if (levelKey(prog.from_level) === levelKey(keep.level)) {
    selected = new Set();
    blockers.push(`Both admissions are ${keep.level}, so the terms cannot be told apart automatically. Choose the terms that belong to ${oldNo || 'the earlier admission'}.`);
  } else {
    selected = new Set(rows.filter((r) => levelKey(r.level) === levelKey(prog.from_level)).map((r) => r.term_id));
  }

  const moving = rows.filter((r) => selected.has(r.term_id));
  const staying = rows.filter((r) => !selected.has(r.term_id));
  const payments = keep.fee_records.filter((f) => f.term_id && selected.has(f.term_id));
  if (staying.length === 0 && rows.length > 0) blockers.push('That would move every term off the current admission.');
  if (moving.length === 0 && blockers.length === 0) warnings.push('No term bills of the earlier admission were found, so it is restored without any bills.');
  const looseCount = keep.fee_records.filter((f) => !f.term_id).length;
  if (looseCount) warnings.push(`${looseCount} payment${looseCount === 1 ? '' : 's'} on this record ${looseCount === 1 ? 'is' : 'are'} not tied to a term and stay${looseCount === 1 ? 's' : ''} with the current admission.`);

  const movedAfter = chain(moving);
  const stayAfter = chain(staying);
  const asRows = (c) => c.map((r) => ({ total_fees: r.total_fees, amount_paid: r.amount_paid, previous_balance_carryover: r.previous_balance_carryover, carried_from_term_id: r.carried_from_term_id }));
  const before = summarizeBalances(rows);
  const keepAfter = summarizeBalances(asRows(stayAfter));
  const restoredAfter = summarizeBalances(asRows(movedAfter));
  const keepBefore = before;
  const dropped = round2(keepBefore.outstanding - keepAfter.outstanding);
  if (moving.length && Math.abs(dropped) > 0.009) warnings.push(`The current admission stops carrying ${dropped > 0 ? `KES ${Math.abs(dropped).toLocaleString()} owed` : `a credit of KES ${Math.abs(dropped).toLocaleString()}`} from the earlier admission. It moves to ${oldNo}, so the total across both does not change.`);

  const chosenStatus = STATUSES.includes(status) ? status : 'GRADUATED';
  const name = [app?.surname || keep.application?.surname, app?.other_names || keep.application?.other_names].filter(Boolean).join(' ');
  return {
    progression_id: prog.id,
    current: { id: keep.id, admission_no: keep.admission_no, name, level: keep.level, course: keep.course?.name || null },
    restore: {
      admission_no: oldNo, level: prog.from_level, intake: prog.from_intake, year: prog.from_year, course: prog.from_course_name,
      status: chosenStatus, application_no: app?.application_no || null, admitted_on: prog.from_started_at,
    },
    terms: [...rows].sort((a, b) => startOf(a) - startOf(b)).map((r) => ({ term_id: r.term_id, term: `${r.term.name} (${r.term.academic_year})`, level: r.level, billed: r.total_fees, paid: r.amount_paid, moves: selected.has(r.term_id) })),
    payments_moving: payments.length,
    money: {
      current_before: keepBefore.outstanding, current_after: keepAfter.outstanding,
      restored_after: restoredAfter.outstanding,
      total_before: keepBefore.outstanding, total_after: round2(keepAfter.outstanding + restoredAfter.outstanding),
    },
    warnings, blockers, can_restore: blockers.length === 0,
    // internal, for apply
    _app: app, _keep: keep, _prog: prog, _moving: moving, _staying: staying, _payments: payments, _status: chosenStatus,
  };
};

const publicPlan = (p) => { const { _app, _keep, _prog, _moving, _staying, _payments, _status, ...rest } = p; return rest; };

const previewRestore = async (progressionId, opts) => publicPlan(await planRestore(progressionId, opts));

// Every earlier merge, and whether each can be restored
const listPastMerges = async () => {
  const progs = await prisma.studentProgression.findMany({ where: { kind: 'LINKED' }, select: { id: true }, orderBy: { created_at: 'asc' } });
  const out = [];
  for (const p of progs) {
    try {
      const pl = await planRestore(p.id);
      out.push({
        progression_id: p.id, current_student_id: pl.current.id, current_admission_no: pl.current.admission_no, name: pl.current.name,
        earlier_admission_no: pl.restore.admission_no, earlier_level: pl.restore.level, current_level: pl.current.level,
        terms_to_move: pl.terms.filter((t) => t.moves).length, payments_to_move: pl.payments_moving,
        can_restore: pl.can_restore, blocker: pl.blockers[0] || null,
      });
    } catch (e) { out.push({ progression_id: p.id, can_restore: false, blocker: e.message }); }
  }
  return out;
};

// Put the earlier admission back as its own record, linked under the current one
const applyRestore = async (progressionId, meta, { termIds, status, acknowledge = false } = {}) => {
  const pl = await planRestore(progressionId, { termIds, status });
  if (!pl.can_restore) throw fail(pl.blockers[0], 400, { preview: publicPlan(pl) });
  if (pl.warnings.length && !acknowledge) throw fail('Please read the notes and confirm to restore this admission', 409, { code: 'NEEDS_ACKNOWLEDGEMENT', preview: publicPlan(pl) });

  const { _app: app, _keep: keep, _prog: prog, _moving: moving, _payments: payments } = pl;
  const email = await loginEmailFor(prog.old_admission_no);
  // the standard temporary password; the login is switched off while linked, and must be changed if ever unlinked
  const password = await bcrypt.hash(`NTVC@${new Date().getFullYear()}`, 12);
  const lastMoved = [...moving].sort((a, b) => startOf(a) - startOf(b)).pop();

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, password, role: 'STUDENT', is_active: false, must_change_password: true } });
    const student = await tx.student.create({
      data: {
        admission_no: prog.old_admission_no, user_id: user.id, application_id: app.id,
        course_id: app.course_id || keep.course_id, department_id: app.department_id || keep.department_id,
        level: prog.from_level, intake: prog.from_intake, year: prog.from_year,
        admission_month_shortcode: getMonthShortcode(prog.from_intake),
        status: pl._status, student_type_id: keep.student_type_id || null,
        current_term_id: lastMoved ? lastMoved.term_id : null,
        ...(prog.from_started_at ? { created_at: prog.from_started_at } : {}),
        primary_student_id: keep.id, linked_at: new Date(), linked_by: meta.userId, link_parked_login: true,
      },
    });
    if (moving.length) await tx.studentBalance.updateMany({ where: { id: { in: moving.map((r) => r.id) } }, data: { student_id: student.id } });
    if (payments.length) await tx.feeRecord.updateMany({ where: { id: { in: payments.map((f) => f.id) } }, data: { student_id: student.id } });

    // Each admission's own carry-forward, from the figures as they are stored
    for (const sid of [student.id, keep.id]) {
      const fresh = await tx.studentBalance.findMany({ where: { student_id: sid }, include: { term: true } });
      for (const c of chain(fresh)) {
        const old = fresh.find((r) => r.id === c.id);
        const changed = Math.abs((old.previous_balance_carryover || 0) - c.previous_balance_carryover) > 0.009 || Math.abs((old.balance || 0) - c.balance) > 0.009 || old.status !== c.status || (old.carried_from_term_id || null) !== (c.carried_from_term_id || null);
        if (changed) await tx.studentBalance.update({ where: { id: c.id }, data: { previous_balance_carryover: c.previous_balance_carryover, balance: c.balance, status: c.status, carried_from_term_id: c.carried_from_term_id } });
      }
    }

    await tx.application.update({ where: { id: app.id }, data: { continuing_student_id: null } });
    await tx.studentProgression.delete({ where: { id: prog.id } });
    return { student, user };
  }, { timeout: 60000 });

  await prisma.auditTrail.create({
    data: {
      user_id: meta.userId, action: 'ADMISSION_RESTORED', entity_type: 'STUDENT', entity_id: keep.id,
      old_values: JSON.stringify({
        removed_history_entry: { id: prog.id, kind: prog.kind, old_admission_no: prog.old_admission_no, from_level: prog.from_level, to_level: prog.to_level, from_started_at: prog.from_started_at },
        moved_term_bill_ids: moving.map((r) => r.id), moved_payment_ids: payments.map((f) => f.id),
      }),
      new_values: JSON.stringify({ restored_admission: prog.old_admission_no, restored_student_id: result.student.id, linked_under: keep.admission_no, status: pl._status, money: pl.money }),
      ip_address: meta.ip || null, user_agent: meta.userAgent || null,
    },
  }).catch((e) => console.error('audit failed', e.message));

  return { restored: prog.old_admission_no, linked_under: keep.admission_no, terms_moved: moving.length, payments_moved: payments.length, money: pl.money };
};

module.exports = { previewRestore, listPastMerges, applyRestore, chain };
