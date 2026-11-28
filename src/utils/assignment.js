const { parsePaidAt } = require('./paymentDate');

// The date and note given when students are put in a term (or moved). Both optional: the date defaults to today,
// can be any earlier day, never a future one.
const readAssignment = (req) => {
  let assigned_on;
  try { assigned_on = parsePaidAt(req.body?.assigned_on); }
  catch { throw Object.assign(new Error('The date of allocation must be a real date, today or earlier'), { status: 400 }); }
  const note = String(req.body?.notes ?? '').trim().replace(/\s+/g, ' ');
  if (note.length > 300) throw Object.assign(new Error('Keep the note under 300 characters'), { status: 400 });
  return { assigned_on, note: note || null, by: req.user.id };
};

module.exports = { readAssignment };
