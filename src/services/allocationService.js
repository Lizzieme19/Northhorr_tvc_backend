const { round2 } = require('./billingService');

// Moving received money onto voteheads without losing where it came from.
//
// Money is taken from the term's unallocated payments, oldest first. Every part keeps what the payment was recorded
// with: its notes (which usually carry the bank or M-Pesa reference), its reference code, the date it was received
// and who received it. A note given while allocating is added after the original one.
//   * a payment used up completely simply becomes the allocation (the same record)
//   * a payment used partly stays with what is left, and the part allocated is a copy of it

const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });

const withNote = (original, note) => [original, note && `Allocation: ${note}`].filter(Boolean).join(' · ') || null;

// A reference code can belong to one record only, so a part of a payment gets the same code with -2, -3... after it
const partReference = async (db, code) => {
  if (!code) return null;
  for (let n = 2; ; n += 1) {
    const candidate = `${code}-${n}`;
    if (!(await db.feeRecord.findUnique({ where: { reference_code: candidate } }))) return candidate;
  }
};

// db: a transaction. allocations: [{ fee_type_id, amount }]. paidAt (optional) replaces the date on the parts allocated.
const moveToVoteheads = async (db, { studentId, termId, allocations, note, paidAt }) => {
  const found = await db.feeRecord.findMany({ where: { student_id: studentId, term_id: termId, fee_type_id: null }, orderBy: { paid_at: 'asc' } });
  const sources = found.map((r) => ({ ...r, left: r.amount }));
  const available = round2(sources.reduce((t, r) => t + r.left, 0));
  const wanted = round2(allocations.reduce((t, a) => t + (Number(a.amount) || 0), 0));
  if (wanted > available + 0.01) {
    throw fail(`Cannot allocate KES ${wanted}. Only KES ${available.toFixed(2)} is available to allocate.`, 400, { availableToAllocate: available });
  }

  const parts = []; // { id, fee_type_id, amount, reference_code, notes }
  let at = 0;
  for (const a of allocations) {
    let need = round2(Number(a.amount) || 0);
    while (need > 0.009 && at < sources.length) {
      const src = sources[at];
      const take = Math.min(need, src.left);
      const date = paidAt ? { paid_at: paidAt } : {};
      let part;
      if (src.left - take <= 0.009) {
        // all that is left of this payment goes here, so the record itself becomes the allocation
        part = await db.feeRecord.update({ where: { id: src.id }, data: { fee_type_id: a.fee_type_id, amount: round2(src.left), notes: withNote(src.notes, note), ...date } });
        at += 1;
      } else {
        part = await db.feeRecord.create({
          data: {
            student_id: studentId, term_id: termId, fee_type_id: a.fee_type_id, amount: round2(take),
            received_by: src.received_by, paid_at: src.paid_at, notes: withNote(src.notes, note),
            reference_code: await partReference(db, src.reference_code), ...date,
          },
        });
        src.left = round2(src.left - take);
        await db.feeRecord.update({ where: { id: src.id }, data: { amount: src.left } });
      }
      parts.push(part);
      need = round2(need - take);
    }
  }
  return parts;
};

module.exports = { moveToVoteheads, withNote };
