// Kenyan mobile numbers. Accepts what people actually type (spaces, dashes, 07.., 01.., 7.., 254.., +254.., 00254..)
// and returns the one form the college stores: 07XXXXXXXX or 01XXXXXXXX. Anything that is not a Kenyan mobile
// number gives null.

const normalizeKenyaPhone = (raw) => {
  if (raw === undefined || raw === null) return null;
  let s = String(typeof raw === 'number' ? Math.trunc(raw) : raw).replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (s.startsWith('+254')) s = `0${s.slice(4)}`;
  else if (s.startsWith('00254')) s = `0${s.slice(5)}`;
  else if (s.startsWith('254') && s.length === 12) s = `0${s.slice(3)}`;
  else if (/^[17]\d{8}$/.test(s)) s = `0${s}`;
  return /^0[17]\d{8}$/.test(s) ? s : null;
};

const PHONE_HELP = 'Enter a Kenyan mobile number such as 0712 345 678, 0112 345 678 or +254 712 345 678';

module.exports = { normalizeKenyaPhone, PHONE_HELP };
