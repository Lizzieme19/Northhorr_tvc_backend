// "Level 5", "L5" and "5" are all in use for levels; admission numbers and comparisons use the "L5" form
const levelCodeOf = (level) => {
  const m = String(level || '').match(/\d+/);
  return m ? `L${m[0]}` : String(level || '');
};

const sameLevel = (a, b) => levelCodeOf(a) === levelCodeOf(b);

module.exports = { levelCodeOf, sameLevel };
