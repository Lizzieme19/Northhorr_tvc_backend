/**
 * cleanup_test_data.js
 *
 * Safely removes test student records and all their linked data.
 *
 * Usage:
 *   node scripts/cleanup_test_data.js             ← dry-run (no changes)
 *   node scripts/cleanup_test_data.js --fix        ← actually delete
 *
 * Targets:
 *   • Students whose name contains "test" (case-insensitive)
 *   • Specifically: "Simiyu Frankline"
 *
 * Deletion order (respects FK constraints):
 *   StudentBalance → FeeRecord → StudentProgression → AdmissionLetter
 *   → RefreshToken → Student → Application → User
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--fix');

// ─── EXPLICIT list of names to delete ───────────────────────────────────────
// Only students whose full name EXACTLY matches one of these (case-insensitive)
// will be targeted. No wildcards or substrings — prevents accidental deletions.
const TEST_NAMES_TO_DELETE = [
  'Testing Data',      // COS/L6/002/26/S
  'test test',         // BKT/L4/001/26/S
  'FRANK Test',        // PB/L5/001/26/S
  'Simiyu Frankline',  // LPT/L5/001/26/S
];

// Normalise for comparison: lowercase and collapse extra spaces
const normalise = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

const TARGET_SET = new Set(TEST_NAMES_TO_DELETE.map(normalise));

function isTestStudent(student) {
  const { surname = '', other_names = '' } = student.application || {};

  // Try both "Surname OtherNames" and "OtherNames Surname" orderings
  const nameA = normalise(`${surname} ${other_names}`);
  const nameB = normalise(`${other_names} ${surname}`);

  return TARGET_SET.has(nameA) || TARGET_SET.has(nameB);
}

async function main() {
  console.log('\n🧹 Test Data Cleanup Script');
  console.log(`Mode: ${DRY_RUN ? '📋 DRY RUN (no changes will be made)' : '🔥 FIX MODE (will permanently delete records)'}\n`);

  if (!DRY_RUN) {
    console.log('⚠️  WARNING: This will permanently delete records from the database!');
    console.log('   Waiting 3 seconds... Press Ctrl+C to abort.\n');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Fetch all students with their application data for name matching
  const allStudents = await prisma.student.findMany({
    include: {
      application: {
        select: { id: true, surname: true, other_names: true, status: true },
      },
      user: { select: { id: true, email: true } },
    },
  });

  const targets = allStudents.filter(isTestStudent);

  if (targets.length === 0) {
    console.log('✅ No test students found. Database looks clean!\n');
    return;
  }

  console.log(`Found ${targets.length} test student(s) to remove:\n`);
  console.log('─'.repeat(80));

  for (const student of targets) {
    const fullName = `${student.application?.surname || ''} ${student.application?.other_names || ''}`.trim();
    console.log(`  Student:      ${fullName}`);
    console.log(`  Admission No: ${student.admission_no}`);
    console.log(`  Email:        ${student.user?.email || 'N/A'}`);
    console.log(`  App Status:   ${student.application?.status || 'N/A'}`);

    if (DRY_RUN) {
      console.log(`  → Would delete: StudentBalance, FeeRecord, StudentProgression,`);
      console.log(`                  AdmissionLetter, RefreshToken, Student, Application, User`);
      console.log('─'.repeat(80));
      continue;
    }

    // ── DELETION (in dependency order) ──────────────────────────────────────
    try {
      // 1. StudentBalance
      const sb = await prisma.studentBalance.deleteMany({ where: { student_id: student.id } });
      console.log(`  ✔ Deleted ${sb.count} StudentBalance record(s)`);

      // 2. FeeRecord
      const fr = await prisma.feeRecord.deleteMany({ where: { student_id: student.id } });
      console.log(`  ✔ Deleted ${fr.count} FeeRecord(s)`);

      // 3. StudentProgression
      const sp = await prisma.studentProgression.deleteMany({ where: { student_id: student.id } });
      console.log(`  ✔ Deleted ${sp.count} StudentProgression(s)`);

      // 4. AdmissionLetter
      const al = await prisma.admissionLetter.deleteMany({ where: { student_id: student.id } });
      console.log(`  ✔ Deleted ${al.count} AdmissionLetter(s)`);

      // 5. RefreshToken (belongs to User)
      if (student.user?.id) {
        const rt = await prisma.refreshToken.deleteMany({ where: { user_id: student.user.id } });
        console.log(`  ✔ Deleted ${rt.count} RefreshToken(s)`);
      }

      // 6. Student
      await prisma.student.delete({ where: { id: student.id } });
      console.log(`  ✔ Deleted Student record`);

      // 7. Application
      if (student.application?.id) {
        await prisma.application.delete({ where: { id: student.application.id } });
        console.log(`  ✔ Deleted Application record`);
      }

      // 8. User
      if (student.user?.id) {
        await prisma.user.delete({ where: { id: student.user.id } });
        console.log(`  ✔ Deleted User account (${student.user.email})`);
      }

      console.log(`  ✅ "${fullName}" fully removed.`);
    } catch (err) {
      console.error(`  ❌ Failed to delete "${fullName}": ${err.message}`);
    }

    console.log('─'.repeat(80));
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const [totalStudents, totalApps] = await Promise.all([
    prisma.student.count(),
    prisma.application.count({ where: { status: 'APPROVED' } }),
  ]);

  console.log(`\n📊 Database counts after ${DRY_RUN ? 'dry run' : 'cleanup'}:`);
  console.log(`   Total Students:        ${totalStudents}`);
  console.log(`   Approved Applications: ${totalApps}`);

  if (!DRY_RUN) {
    console.log('\n✅ Cleanup complete. Run without --fix to verify no test data remains.\n');
  } else {
    console.log('\n👆 Run with --fix to actually delete the above records.\n');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
