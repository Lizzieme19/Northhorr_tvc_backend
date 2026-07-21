require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Cleanup script to delete all students and related data
 * This is for testing purposes only - use with caution!
 */

async function cleanupStudents() {
  console.log('⚠️  WARNING: This will delete ALL students and related data!');
  console.log('Press Ctrl+C to cancel within 5 seconds...');
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log('🔄 Starting cleanup...');

  // Delete in order of dependencies
  const result = await prisma.$transaction([
    // Delete fee records
    prisma.feeRecord.deleteMany({}),
    // Delete student balances
    prisma.studentBalance.deleteMany({}),
    // Delete student progressions
    prisma.studentProgression.deleteMany({}),
    // Delete admission letters
    prisma.admissionLetter.deleteMany({}),
    // Delete students
    prisma.student.deleteMany({}),
    // Delete applications
    prisma.application.deleteMany({}),
  ]);

  console.log('✅ Cleanup complete!');
  console.log('Deleted:', {
    feeRecords: result[0].count,
    studentBalances: result[1].count,
    progressions: result[2].count,
    admissionLetters: result[3].count,
    students: result[4].count,
    applications: result[5].count,
  });
}

cleanupStudents()
  .catch((e) => {
    console.error('❌ Cleanup error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
