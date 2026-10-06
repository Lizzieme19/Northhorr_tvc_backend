/**
 * repair_orphan_applications.js
 *
 * Finds APPROVED applications that have no linked student record
 * and optionally creates the missing students.
 *
 * Usage:
 *   node scripts/repair_orphan_applications.js --dry-run   ← just list orphans
 *   node scripts/repair_orphan_applications.js --fix       ← create missing students
 *
 * Known edge-cases handled:
 *   • One email has multiple orphaned applications → duplicate user_id guard.
 *   • Sequential admission-number generation → DB re-read after each commit.
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { generateAdmissionNumber, getMonthShortcode } = require('../src/utils/admissionNumberGenerator');
const { getInitialTermForIntake, createStudentBalance } = require('../src/utils/termHelper');

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--fix');

async function main() {
  console.log(`\n🔍 Checking for orphaned approved applications...`);
  console.log(`Mode: ${DRY_RUN ? '📋 DRY RUN (no changes will be made)' : '🔧 FIX MODE (will create missing students)'}\n`);

  // Find all APPROVED applications that have no student record
  const orphans = await prisma.application.findMany({
    where: {
      status: 'APPROVED',
      student: null,
    },
    include: {
      course: { select: { name: true } },
      department: { select: { name: true } },
    },
    orderBy: { reviewed_at: 'asc' },
  });

  if (orphans.length === 0) {
    console.log('✅ No orphaned applications found. All approved applications have student records.\n');
    return;
  }

  console.log(`⚠️  Found ${orphans.length} approved application(s) with no student record:\n`);
  console.log('─'.repeat(80));

  for (const app of orphans) {
    console.log(`  ID:           ${app.id}`);
    console.log(`  App No:       ${app.application_no}`);
    console.log(`  Name:         ${app.surname} ${app.other_names}`);
    console.log(`  Email:        ${app.email || '❌ MISSING'}`);
    console.log(`  Course:       ${app.course?.name || `❌ MISSING (id: ${app.course_id})`}`);
    console.log(`  Department:   ${app.department?.name || `❌ MISSING (id: ${app.department_id})`}`);
    console.log(`  Level:        ${app.level_applied || '❌ MISSING'}`);
    console.log(`  Approved at:  ${app.reviewed_at}`);

    const canFix = app.email && app.course_id && app.department_id;
    if (!canFix) {
      console.log(`  ❌ Cannot auto-fix: missing${!app.email ? ' email' : ''}${!app.course_id ? ' course' : ''}${!app.department_id ? ' department' : ''}`);
      console.log(`     → Fix the missing fields in the admin portal, then re-run this script.\n`);
      console.log('─'.repeat(80));
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ✅ Eligible for auto-fix (has email, course, department)\n`);
      console.log('─'.repeat(80));
      continue;
    }

    // ── FIX MODE ─────────────────────────────────────────────────────────────
    try {
      console.log(`  🔧 Creating missing student record...`);

      const tempPassword = `NTVC@${new Date().getFullYear()}`;
      const hashed = await bcrypt.hash(tempPassword, 12);

      // ── Step 1: resolve user ─────────────────────────────────────────────
      let user = await prisma.user.findUnique({ where: { email: app.email } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: app.email,
            password: hashed,
            role: 'STUDENT',
            must_change_password: true,
          },
        });
        console.log(`     Created user account for ${app.email}`);
      } else {
        console.log(`     User account already exists for ${app.email}`);
      }

      // ── Step 2: guard duplicate user_id ──────────────────────────────────
      // A user can only have ONE student record. If one already exists
      // (pre-existing or created earlier in this loop), link this orphan
      // application to it instead of attempting a second student.create().
      const existingStudent = await prisma.student.findUnique({
        where: { user_id: user.id },
        select: { id: true, admission_no: true, application_id: true },
      });

      if (existingStudent) {
        if (existingStudent.application_id === app.id) {
          console.log(`  ℹ️  Already linked (${existingStudent.admission_no}). Skipping.\n`);
          console.log('─'.repeat(80));
          continue;
        }

        console.log(`  ⚠️  User already has student ${existingStudent.admission_no} (different application).`);
        console.log(`     Linking application ${app.application_no} → student ${existingStudent.id}...`);

        await prisma.application.update({
          where: { id: app.id },
          data: { student: { connect: { id: existingStudent.id } } },
        });

        console.log(`  ✅ Linked application to existing student ${existingStudent.admission_no}\n`);
        console.log('─'.repeat(80));
        continue;
      }

      // ── Step 3: generate admission number AFTER previous creates commit ───
      // This ensures generateAdmissionNumber reads the latest DB state so
      // sequential orphans in the same course don't collide on admission_no.
      const studentIntake = 'SEPTEMBER';
      const studentYear = app.reviewed_at
        ? new Date(app.reviewed_at).getFullYear()
        : new Date().getFullYear();

      const levelStr = app.level_applied || 'Level 4';
      const levelMatch = levelStr.match(/\d+/);
      const levelCode = levelMatch ? `L${levelMatch[0]}` : 'L4';

      const admissionNo = await generateAdmissionNumber(app.course_id, levelCode, studentIntake, studentYear);
      const monthShortcode = getMonthShortcode(studentIntake);
      const initialTerm = await getInitialTermForIntake(studentIntake, studentYear);

      // ── Step 4: create student record ────────────────────────────────────
      const student = await prisma.student.create({
        data: {
          admission_no: admissionNo,
          user_id: user.id,
          application_id: app.id,
          course_id: app.course_id,
          department_id: app.department_id,
          level: levelStr,
          intake: studentIntake,
          year: studentYear,
          admission_month_shortcode: monthShortcode,
          current_term_id: initialTerm.id,
          id_copy_front_url: app.id_copy_front_url,
          id_copy_back_url: app.id_copy_back_url,
          parent_id_copy_front_url: app.parent_id_copy_front_url,
          parent_id_copy_back_url: app.parent_id_copy_back_url,
          kcse_certificate_url: app.doc_kcse,
          birth_certificate_url: app.doc_birth_cert,
          medical_report_url: app.doc_medical,
          status: 'ACTIVE',
        },
      });

      await createStudentBalance(student.id, initialTerm.id, levelStr);

      console.log(`  ✅ Student created: ${admissionNo} (student ID: ${student.id})\n`);
    } catch (err) {
      console.error(`  ❌ Failed to create student for ${app.application_no}: ${err.message}\n`);
    }
    console.log('─'.repeat(80));
  }

  // Final counts
  const [totalStudents, approvedApps] = await Promise.all([
    prisma.student.count(),
    prisma.application.count({ where: { status: 'APPROVED' } }),
  ]);

  console.log(`\n📊 Current counts after ${DRY_RUN ? 'dry run' : 'fix'}:`);
  console.log(`   Total Students:        ${totalStudents}`);
  console.log(`   Approved Applications: ${approvedApps}`);
  if (totalStudents !== approvedApps) {
    console.log(`   ⚠️  Still mismatched by ${approvedApps - totalStudents} (some need manual correction)`);
  } else {
    console.log(`   ✅ Counts now match!`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
