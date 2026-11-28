// Fee totals across a student's term balances.
//
// A term row's `balance` already includes debt carried forward from earlier terms
// (balance = total_fees + previous_balance_carryover - amount_paid), and the earlier rows keep
// their own balance. Adding up `balance` across rows therefore counts the same debt repeatedly.
// What is actually owed is what was billed minus what was paid, however it was carried.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// rows: StudentBalance records
const summarizeBalances = (rows = []) => {
  const totalFees = rows.reduce((s, r) => s + (r.total_fees || 0), 0);
  const totalPaid = rows.reduce((s, r) => s + (r.amount_paid || 0), 0);
  // A balance the student started with (e.g. from an import) sits on a row that did not bring it forward from another term
  const opening = rows.reduce((s, r) => s + (r.carried_from_term_id ? 0 : (r.previous_balance_carryover || 0)), 0);
  return {
    totalFees: round2(totalFees),
    totalPaid: round2(totalPaid),
    // negative = the student is in credit
    outstanding: round2(totalFees - totalPaid + opening),
  };
};

// The money position over many students' term rows.
//   owed    = what the students who owe money owe
//   credit  = what the students who have paid more than billed are ahead by
//   net     = owed - credit (billed + brought in - paid)
// For one term, what was brought into the term counts; across terms only an opening balance does (see above).
const owedPosition = (rows = [], oneTerm = false) => {
  const byStudent = new Map();
  for (const r of rows) {
    const brought = oneTerm || !r.carried_from_term_id ? (r.previous_balance_carryover || 0) : 0;
    byStudent.set(r.student_id, (byStudent.get(r.student_id) || 0) + (r.total_fees || 0) + brought - (r.amount_paid || 0));
  }
  let owed = 0; let credit = 0; let studentsOwing = 0; let studentsInCredit = 0;
  for (const v of byStudent.values()) {
    if (v > 0.009) { owed += v; studentsOwing += 1; } else if (v < -0.009) { credit -= v; studentsInCredit += 1; }
  }
  return { owed: round2(owed), credit: round2(credit), net: round2(owed - credit), studentsOwing, studentsInCredit };
};

module.exports = { summarizeBalances, owedPosition, round2 };
