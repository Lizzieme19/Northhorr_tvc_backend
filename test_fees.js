const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const fees = await prisma.feeRecord.findMany({
    include: {
      student: { select: { admission_no: true } }
    }
  });
  console.log("Fee Records:");
  console.log(fees);
}
main().catch(console.error).finally(() => prisma.$disconnect());
