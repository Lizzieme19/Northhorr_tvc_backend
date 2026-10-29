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
  return {
    totalFees: round2(totalFees),
    totalPaid: round2(totalPaid),
    // negative = the student is in credit
    outstanding: round2(totalFees - totalPaid),
  };
};

module.exports = { summarizeBalances, round2 };
