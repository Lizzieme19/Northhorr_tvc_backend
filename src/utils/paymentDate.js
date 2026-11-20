// The date a payment was received. Finance can record a payment on any earlier day (backdating has no limit),
// but never on a day that has not happened yet. Days are counted in East Africa Time (UTC+3), where the college is.

const EAT_MS = 3 * 3600 * 1000;
const dayOf = (d) => new Date(d.getTime() + EAT_MS).toISOString().slice(0, 10);
const FLOOR = '2000-01-01'; // catches typing mistakes such as 0026 or 1926

const bad = (message) => Object.assign(new Error(message), { status: 400 });

// '2026-10-01' (or a full timestamp) -> the Date to store; undefined when nothing was given (the payment is
// stamped with the current time). A date-only value for an earlier day is stored at midday so that it shows as
// that day everywhere.
const parsePaidAt = (input) => {
  if (input === undefined || input === null || input === '') return undefined;
  const s = String(input).trim();
  let when;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const probe = new Date(`${s}T12:00:00.000Z`);
    if (isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== s) throw bad('The payment date is not a valid date');
    const today = dayOf(new Date());
    if (s > today) throw bad('A payment cannot be dated in the future');
    if (s < FLOOR) throw bad('The payment date looks wrong. Check the year');
    return s === today ? new Date() : new Date(`${s}T09:00:00.000Z`);
  }
  when = new Date(s);
  if (isNaN(when.getTime())) throw bad('The payment date is not a valid date');
  const day = dayOf(when);
  if (day > dayOf(new Date())) throw bad('A payment cannot be dated in the future');
  if (day < FLOOR) throw bad('The payment date looks wrong. Check the year');
  return when;
};

// How many days ago (0 = today), for the activity log and warnings
const daysAgo = (d) => Math.round((new Date(`${dayOf(new Date())}T00:00:00Z`) - new Date(`${dayOf(d)}T00:00:00Z`)) / 86400000);

module.exports = { parsePaidAt, daysAgo, dayOf };
