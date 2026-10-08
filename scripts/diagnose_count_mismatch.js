/**
 * diagnose_count_mismatch.js
 *
 * Diagnoses the mismatch between Total Students and Approved Applications.
 * Reports:
 *   1. Students whose linked application is NOT 'APPROVED'
 *   2. APPROVED applications that have no linked student (orphan apps)
 *   3. Summary counts
 *
 * Usage:
 *   node scripts/diagnose_count_mismatch.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('\n🔍 Student / Application Count Mismatch Diagnostics\n');
  console.log('─'.repeat(80));

  // ── 1. Total counts ─────────────────────────────────────────────────────────
  const [totalStudents, approvedApps] = await Promise.all([
    prisma.student.count(),
    prisma.application.count({ where: { status: 'APPROVED' } }),
  ]);

  console.log(`📊 Counts:`);
  console.log(`   Total Students:        ${totalStudents}`);
  console.log(`   Approved Applications: ${approvedApps}`);
  console.log(`   Difference:            ${totalStudents - approvedApps} (students without approved apps)`);
  console.log('─'.repeat(80));

  // ── 2. Students whose application is NOT APPROVED ───────────────────────────
  const mismatchedStudents = await prisma.student.findMany({
    where: {
      application: {
        status: { not: 'APPROVED' },
      },
    },
    include: {
      application: {
        select: {
          application_no: true,
          surname: true,
          other_names: true,
          status: true,
          reviewed_at: true,
        },
      },
      user: { select: { email: true } },
    },
  });

  if (mismatchedStudents.length === 0) {
    console.log('✅ No students with non-APPROVED applications found.\n');
  } else {
    console.log(`\n⚠️  ${mismatchedStudents.length} student(s) whose application is NOT APPROVED:\n`);
    for (const s of mismatchedStudents) {
      const name = `${s.application?.surname || ''} ${s.application?.other_names || ''}`.trim();
      console.log(`  Admission No:   ${s.admission_no}`);
      console.log(`  Name:           ${name}`);
      console.log(`  Email:          ${s.user?.email || 'N/A'}`);
      console.log(`  App No:         ${s.application?.application_no || 'N/A'}`);
      console.log(`  App Status:     ${s.application?.status || 'N/A'} ← should be APPROVED`);
      console.log(`  Reviewed At:    ${s.application?.reviewed_at || 'never'}`);

      if (process.argv.includes('--fix') && s.application?.application_no) {
        console.log(`\n  🔧 FIXING: Updating application status to APPROVED...`);
        try {
          await prisma.application.update({
            where: { application_no: s.application.application_no },
            data: { status: 'APPROVED', reviewed_at: new Date() }
          });
          console.log(`  ✅ Successfully updated to APPROVED.`);
        } catch (err) {
          console.error(`  ❌ Failed to update: ${err.message}`);
        }
      } else {
        console.log(`\n  💡 Fix options:`);
        console.log(`     A) Run this script with --fix to automatically set to APPROVED`);
        console.log(`     B) Delete the orphan student record (use cleanup_test_data.js pattern)`);
      }
      console.log('─'.repeat(80));
    }
  }

  // ── 3. APPROVED applications with no linked student (orphan apps) ────────────
  const orphanApps = await prisma.application.findMany({
    where: {
      status: 'APPROVED',
      student: null,
    },
    select: {
      application_no: true,
      surname: true,
      other_names: true,
      email: true,
      reviewed_at: true,
      course: { select: { name: true } },
    },
    orderBy: { reviewed_at: 'asc' },
  });

  if (orphanApps.length === 0) {
    console.log('✅ No approved applications without a student record found.\n');
  } else {
    console.log(`\n⚠️  ${orphanApps.length} APPROVED application(s) with NO student record:\n`);
    for (const app of orphanApps) {
      const name = `${app.surname} ${app.other_names}`.trim();
      console.log(`  App No:         ${app.application_no}`);
      console.log(`  Name:           ${name}`);
      console.log(`  Email:          ${app.email || 'MISSING'}`);
      console.log(`  Course:         ${app.course?.name || 'MISSING'}`);
      console.log(`  Reviewed At:    ${app.reviewed_at || 'never'}`);
      console.log(`\n  💡 Fix: run repair_orphan_applications.js --fix`);
      console.log('─'.repeat(80));
    }
  }

  // ── Final verdict ────────────────────────────────────────────────────────────
  console.log('\n📋 Summary:');
  if (mismatchedStudents.length === 0 && orphanApps.length === 0) {
    console.log('   ✅ Everything looks consistent! No mismatches found.\n');
  } else {
    if (mismatchedStudents.length > 0) {
      console.log(`   ⚠️  ${mismatchedStudents.length} student(s) linked to a non-APPROVED application`);
      console.log(`      → Fix A: correct the application status to APPROVED`);
      console.log(`      → Fix B: delete the orphan student if they are test/invalid data`);
    }
    if (orphanApps.length > 0) {
      console.log(`   ⚠️  ${orphanApps.length} approved application(s) missing a student record`);
      console.log(`      → Run: node scripts/repair_orphan_applications.js --fix`);
    }
    console.log('');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
