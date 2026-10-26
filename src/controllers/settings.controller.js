const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * GET /api/settings/:key  — public read for specific keys
 * Only safe, non-sensitive keys are exposed without auth.
 */
const PUBLIC_KEYS = ['student_edit_deadline'];

const getSetting = async (req, res) => {
  const { key } = req.params;
  if (!PUBLIC_KEYS.includes(key)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key } });
    if (!setting) return res.status(404).json({ error: 'Setting not found' });
    res.json({ key: setting.key, value: setting.value });
  } catch (err) {
    console.error('getSetting error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PATCH /api/settings/:key  — admin only, update a setting value
 */
const updateSetting = async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (!value) return res.status(400).json({ error: 'value is required' });
  try {
    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value, updated_at: new Date() },
      create: { key, value },
    });
    res.json({ key: setting.key, value: setting.value, updated_at: setting.updated_at });
  } catch (err) {
    console.error('updateSetting error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/settings  — admin: list all settings
 */
const getAllSettings = async (req, res) => {
  try {
    const settings = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    res.json(settings);
  } catch (err) {
    console.error('getAllSettings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getSetting, updateSetting, getAllSettings };
