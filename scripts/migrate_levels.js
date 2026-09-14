/**
 * migrate_levels.js
 * One-off script: converts Course.levels from comma-separated string
 * to structured JSON array.
 *
 * Run: node scripts/migrate_levels.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function parseOldLevels(levelsStr) {
  if (!levelsStr) return [];

  // Already valid JSON array? Skip re-parse
  const trimmed = levelsStr.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed; // already migrated
    } catch (_) { /* fall through */ }
  }

  // Split comma-separated string
  return trimmed
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(name => ({
      name,
      entry_requirement: 'KCSE', // sensible default; admin can adjust
      min_kcse_grade: null,
      min_kcpe_marks: null,
    }));
}

async function main() {
  const courses = await prisma.course.findMany({
    select: { id: true, name: true, levels: true },
  });

  console.log(`Found ${courses.length} courses to migrate.`);

  let migrated = 0;
  let skipped = 0;

  for (const course of courses) {
    const parsed = parseOldLevels(course.levels);

    // Already structured — check first element
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      typeof parsed[0] === 'object' &&
      'entry_requirement' in parsed[0]
    ) {
      console.log(`  SKIP  "${course.name}" — already structured`);
      skipped++;
      continue;
    }

    const newValue = JSON.stringify(parsed);
    await prisma.course.update({
      where: { id: course.id },
      data: { levels: newValue },
    });

    console.log(`  OK    "${course.name}" => ${newValue}`);
    migrated++;
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);
}

main()
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
