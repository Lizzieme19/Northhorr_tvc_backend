const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const unallocated = await prisma.feeRecord.findMany({ where: { fee_type_id: null } });
  for (const record of unallocated) {
    const allocated = await prisma.feeRecord.findMany({ 
      where: { student_id: record.student_id, term_id: record.term_id, fee_type_id: { not: null }, paid_at: { gte: record.paid_at } }
    });
    const allocTotal = allocated.reduce((sum, r) => sum + r.amount, 0);
    if (allocTotal > 0) {
      console.log(`Student ${record.student_id}, Term ${record.term_id}: Unallocated=${record.amount}, Allocated After=${allocTotal}`);
      const newAmount = record.amount - allocTotal;
      if (newAmount <= 0.01) {
        console.log(`Deleting fully consumed unallocated record ${record.id}`);
        await prisma.feeRecord.delete({ where: { id: record.id } });
      } else {
        console.log(`Updating unallocated record ${record.id} to amount ${newAmount}`);
        await prisma.feeRecord.update({ where: { id: record.id }, data: { amount: newAmount } });
      }
    }
  }
}
run().catch(console.error).finally(() => prisma.$disconnect());
