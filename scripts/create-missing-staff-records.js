const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createMissingStaffRecords() {
  try {
    console.log('Finding STAFF role users without Staff records...');
    
    // Get all users with STAFF role
    const staffUsers = await prisma.user.findMany({
      where: { role: 'STAFF', is_active: true },
      select: { id: true, email: true }
    });

    console.log(`Found ${staffUsers.length} STAFF role users`);

    for (const user of staffUsers) {
      // Check if Staff record exists
      const existingStaff = await prisma.staff.findUnique({
        where: { user_id: user.id }
      });

      if (!existingStaff) {
        console.log(`Creating Staff record for user: ${user.email}`);
        
        const empNumber = `STF${Date.now().toString().slice(-6)}`;
        
        const staff = await prisma.staff.create({
          data: {
            user_id: user.id,
            employee_number: empNumber,
            first_name: user.email.split('@')[0],
            last_name: 'Staff',
            gender: 'Other',
            date_of_birth: new Date('1990-01-01'),
            employment_type: 'FULL_TIME',
            date_hired: new Date(),
          },
        });

        console.log(`Created Staff record with ID: ${staff.id}`);

        // Initialize leave balances
        const currentYear = new Date().getFullYear();
        await prisma.leaveBalance.createMany({
          data: [
            { staff_id: staff.id, leave_type: 'ANNUAL', year: currentYear, total_days: 21 },
            { staff_id: staff.id, leave_type: 'SICK', year: currentYear, total_days: 14 },
            { staff_id: staff.id, leave_type: 'COMPASSIONATE', year: currentYear, total_days: 7 },
          ],
        });

        console.log(`Initialized leave balances for staff ID: ${staff.id}`);
      } else {
        console.log(`Staff record already exists for user: ${user.email}`);
      }
    }

    console.log('Done!');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createMissingStaffRecords();
