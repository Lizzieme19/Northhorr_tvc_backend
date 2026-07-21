require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Migration script to handle existing student fee data
 * This script:
 * 1. Creates fee records from existing student fee flags
 * 2. Preserves existing payment status
 * 3. Does NOT delete any student data
 */

async function migrateFeeData() {
  console.log('🔄 Starting fee data migration...');

  // Get all fee types
  const feeTypes = await prisma.feeType.findMany();
  console.log(`Found ${feeTypes.length} fee types`);

  if (feeTypes.length === 0) {
    console.error('❌ No fee types found. Please run seed script first.');
    process.exit(1);
  }

  // Create a map of fee type codes to IDs
  const feeTypeMap = {};
  feeTypes.forEach(ft => {
    feeTypeMap[ft.code] = ft.id;
  });

  // Get all students
  const students = await prisma.student.findMany({
    include: { fee_records: true },
  });

  console.log(`Found ${students.length} students`);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const student of students) {
    const feeRecordsToCreate = [];

    // Check admission fee
    if (student.admission_fee_paid) {
      const existingRecord = student.fee_records.find(
        fr => fr.fee_type_id === feeTypeMap['ADMISSION']
      );
      if (!existingRecord && feeTypeMap['ADMISSION']) {
        const admissionFeeType = feeTypes.find(ft => ft.code === 'ADMISSION');
        feeRecordsToCreate.push({
          student_id: student.id,
          fee_type_id: feeTypeMap['ADMISSION'],
          amount: admissionFeeType?.amount || 1000,
          reference_code: `MIG-ADM-${student.admission_no}`,
          received_by: 'SYSTEM_MIGRATION',
        });
      }
    }

    // Check student ID fee
    if (student.student_id_fee_paid) {
      const existingRecord = student.fee_records.find(
        fr => fr.fee_type_id === feeTypeMap['STUDENT_ID']
      );
      if (!existingRecord && feeTypeMap['STUDENT_ID']) {
        const idFeeType = feeTypes.find(ft => ft.code === 'STUDENT_ID');
        feeRecordsToCreate.push({
          student_id: student.id,
          fee_type_id: feeTypeMap['STUDENT_ID'],
          amount: idFeeType?.amount || 500,
          reference_code: `MIG-ID-${student.admission_no}`,
          received_by: 'SYSTEM_MIGRATION',
        });
      }
    }

    // Check KUCCPS fee
    if (student.kuccps_fee_paid) {
      const existingRecord = student.fee_records.find(
        fr => fr.fee_type_id === feeTypeMap['KUCCPS']
      );
      if (!existingRecord && feeTypeMap['KUCCPS']) {
        const kuccpsFeeType = feeTypes.find(ft => ft.code === 'KUCCPS');
        feeRecordsToCreate.push({
          student_id: student.id,
          fee_type_id: feeTypeMap['KUCCPS'],
          amount: kuccpsFeeType?.amount || 1500,
          reference_code: `MIG-KUCCPS-${student.admission_no}`,
          received_by: 'SYSTEM_MIGRATION',
        });
      }
    }

    // Check tuition fee
    if (student.tuition_fee_paid) {
      const existingRecord = student.fee_records.find(
        fr => fr.fee_type_id === feeTypeMap['TUITION']
      );
      if (!existingRecord && feeTypeMap['TUITION']) {
        feeRecordsToCreate.push({
          student_id: student.id,
          fee_type_id: feeTypeMap['TUITION'],
          amount: 0, // Tuition amount is per-term, set in term
          reference_code: `MIG-TUIT-${student.admission_no}`,
          received_by: 'SYSTEM_MIGRATION',
        });
      }
    }

    // Create fee records if any
    if (feeRecordsToCreate.length > 0) {
      await prisma.feeRecord.createMany({
        data: feeRecordsToCreate,
      });
      migratedCount += feeRecordsToCreate.length;
      console.log(`✅ Migrated ${feeRecordsToCreate.length} fee records for student ${student.admission_no}`);
    } else {
      skippedCount++;
    }
  }

  console.log('\n🎉 Migration complete!');
  console.log(`Total fee records created: ${migratedCount}`);
  console.log(`Students skipped (no fees to migrate): ${skippedCount}`);
  console.log('\n⚠️  Note: Student fee flags (admission_fee_paid, etc.) are preserved for backward compatibility.');
  console.log('⚠️  New fee records have been created to link payments to fee types.');
}

migrateFeeData()
  .catch((e) => {
    console.error('❌ Migration error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
