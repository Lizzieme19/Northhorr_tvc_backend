require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const departments = [
  {
    slug: 'agriculture', name: 'Agriculture',
    tagline: 'Feeding the nation, sustaining the land',
    description: 'Hands-on training in sustainable farming, livestock production, dairy management and aquaculture.',
    icon: '🌾',
    image_url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
    courses: [
      { name: 'Sustainable Agriculture', levels: 'Level 3, 4, 5, 6', shortcode: 'SAG' },
      { name: 'Agricultural Extension', levels: 'Level 5 & 6', shortcode: 'AEX' },
      { name: 'General Agriculture', levels: 'Level 4', shortcode: 'GAG' },
      { name: 'Animal Production', levels: 'Level 4, 5, 6', shortcode: 'AP' },
      { name: 'Animal Health and Production', levels: 'Level 5, 6', shortcode: 'AHP' },
      { name: 'Aquaculture', levels: 'Level 3, 4, 5', shortcode: 'AQ' },
      { name: 'Dairy Farm Management', levels: 'Level 5, 6', shortcode: 'DFM' },
      { name: 'Dairy Plant Management', levels: 'Level 5, 6', shortcode: 'DPM' },
      { name: 'Dairy Plant Technology', levels: 'Level 4, 5', shortcode: 'DPT' },
      { name: 'Livestock Feed Production', levels: 'Level 4', shortcode: 'LFP' },
      { name: 'Poultry Kienyeji Production', levels: 'Level 3, 4', shortcode: 'PKP' },
      { name: 'Poultry Layer Production', levels: 'Level 3, 4', shortcode: 'PLP' },
      { name: 'Poultry Broiler Production', levels: 'Level 3, 4', shortcode: 'PBP' },
    ],
  },
  {
    slug: 'mechanical-engineering', name: 'Mechanical Engineering',
    tagline: 'Driving Kenya\'s automotive future',
    description: 'Practical skills in motor vehicle, motorcycle and panel beating trades.',
    icon: '🔧',
    image_url: 'https://images.unsplash.com/photo-1632823471565-1ecdf5c6da77?auto=format&fit=crop&w=1200&q=80',
    courses: [
      { name: 'Automotive Technician', levels: 'Level 5, 6', shortcode: 'AT' },
      { name: 'Motor Cycle Mechanics', levels: 'Level 3, 4', shortcode: 'MCM' },
      { name: 'Motor Vehicle Electrics', levels: 'Level 3, 4', shortcode: 'MVE' },
      { name: 'Motor Vehicle Mechanics', levels: 'Level 3, 4', shortcode: 'MVM' },
      { name: 'Panel Beating', levels: 'Level 3', shortcode: 'PB' },
    ],
  },
  {
    slug: 'applied-sciences', name: 'Applied Sciences',
    tagline: 'Where science meets industry',
    description: 'From food technology and baking to laboratory science.',
    icon: '🧪',
    image_url: 'https://images.unsplash.com/photo-1532634922-8fe0b757fb13?auto=format&fit=crop&w=1200&q=80',
    courses: [
      { name: 'Baking', levels: 'Level 3, 4', shortcode: 'BKG' },
      { name: 'Baking Technology', levels: 'Level 5, 6', shortcode: 'BKT' },
      { name: 'Food Technology', levels: 'Level 5, 6', shortcode: 'FDT' },
      { name: 'Meat Product Processing', levels: 'Level 4', shortcode: 'MPP' },
      { name: 'Science Laboratory Technology', levels: 'Level 5, 6', shortcode: 'SLT' },
    ],
  },
  {
    slug: 'building-civil-engineering', name: 'Building & Civil Engineering',
    tagline: 'Building tomorrow, today',
    description: 'Master the trades that build a nation — masonry, carpentry, interior design.',
    icon: '🏗️',
    image_url: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1200&q=80',
    courses: [
      { name: 'Building Technology', levels: 'Level 5 & 6', shortcode: 'BT' },
      { name: 'Carpentry and Joinery', levels: 'Level 3, 4, 5', shortcode: 'CJ' },
      { name: 'Plumbing', levels: 'Level 3, 4, 5', shortcode: 'PLB' },
      { name: 'Masonry', levels: 'Level 3, 4', shortcode: 'MSN' },
      { name: 'Painting and Decoration', levels: 'Level 3', shortcode: 'PD' },
      { name: 'Gypsum Installation', levels: 'Level 3', shortcode: 'GI' },
      { name: 'Interior Design', levels: 'Level 4, 5, 6', shortcode: 'ID' },
      { name: 'Steel Fixing', levels: 'Level 3', shortcode: 'SF' },
      { name: 'Tiling', levels: 'Level 3', shortcode: 'TL' },
    ],
  },
  {
    slug: 'social-sciences', name: 'Social Sciences',
    tagline: 'Caring careers that change communities',
    description: 'Train as a community health worker, social worker or care professional.',
    icon: '🤝',
    image_url: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?auto=format&fit=crop&w=1200&q=80',
    courses: [
      { name: 'Caregiving', levels: 'Level 4', shortcode: 'CG' },
      { name: 'Child Protection', levels: 'Level 5F, 6F', shortcode: 'CP' },
      { name: 'Community-Based Services', levels: 'Level 4', shortcode: 'CBS' },
      { name: 'Community Health', levels: 'Level 5, 6', shortcode: 'CH' },
      { name: 'Health Systems Support (HSS)', levels: 'Level 5', shortcode: 'HSS' },
      { name: 'Health Systems Support Management (HSSM)', levels: 'Level 6', shortcode: 'HSSM' },
      { name: 'Healthcare Support Services', levels: 'Level 5', shortcode: 'HCSS' },
      { name: 'Home Based Care', levels: 'Level 3', shortcode: 'HBC' },
      { name: 'Social Work', levels: 'Level 5, 6', shortcode: 'SW' },
    ],
  },
  {
    slug: 'business', name: 'Business',
    tagline: 'Lead. Manage. Succeed.',
    description: 'Future-ready business courses in HR, procurement, project management.',
    icon: '💼',
    image_url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1200&q=80',
    courses: [
      { name: 'Human Resource', levels: 'Level 5, 6', shortcode: 'HR' },
      { name: 'Storekeeping', levels: 'Level 4', shortcode: 'SK' },
      { name: 'Procurement Management', levels: 'Level 5, 6', shortcode: 'PM' },
      { name: 'Project Management', levels: 'Level 5, 6', shortcode: 'PRM' },
    ],
  },
  {
    slug: 'cosmetology-fashion', name: 'Cosmetology & Fashion',
    tagline: 'Crafting beauty, designing identity',
    description: 'Creative training in fashion design, cosmetology and leather technology.',
    icon: '✂️',
    image_url: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?auto=format&fit=crop&w=1200&q=80',
    courses: [
      { name: 'Cosmetology', levels: 'Level 3, 4, 5, 6', shortcode: 'COS' },
      { name: 'Fashion Design', levels: 'Level 3, 4, 5, 6', shortcode: 'FD' },
      { name: 'Leather Goods Production', levels: 'Level 5', shortcode: 'LGP' },
      { name: 'Leather Processing (Tanning)', levels: 'Level 5', shortcode: 'LPT' },
      { name: 'Leather Technology', levels: 'Level 6', shortcode: 'LT' },
    ],
  },
  {
    slug: 'electrical-electronics', name: 'Electrical & Electronics Engineering',
    tagline: 'Powering Kenya\'s tomorrow',
    description: 'Build skills that power the nation — solar PV, refrigeration, electronics.',
    icon: '⚡',
    image_url: 'https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=1200&q=80',
    courses: [
      { name: 'Electrical Engineering', levels: 'Level 5, 6', shortcode: 'EE' },
      { name: 'Electrical Installation', levels: 'Level 3, 4', shortcode: 'EI' },
      { name: 'Solar PV System Installation', levels: 'Level 3, 4, 5', shortcode: 'SPV' },
      { name: 'Refrigeration and Air Conditioning', levels: 'Level 4, 5, 6', shortcode: 'RAC' },
      { name: 'Electronics Engineering', levels: 'Level 5, 6', shortcode: 'ECE' },
      { name: 'Electronics Technology', levels: 'Level 3, 4', shortcode: 'ECT' },
      { name: 'Electrotechnical Engineering', levels: 'Level 5, 6', shortcode: 'ETE' },
    ],
  },
  {
    slug: 'computing-informatics', name: 'Computing & Informatics',
    tagline: 'Code the future you want',
    description: 'From basic computer operations to ICT technician training.',
    icon: '💻',
    image_url: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=1200&q=80',
    courses: [
      { name: 'Computer Operations', levels: 'Level 3', shortcode: 'CO' },
      { name: 'ICT Operator', levels: 'Level 4', shortcode: 'IO' },
      { name: 'ICT Technician', levels: 'Level 5, 6', shortcode: 'ICT' },
    ],
  },
];

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('Admin@NTVC2026', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ntvc.ac.ke' },
    update: {},
    create: { email: 'admin@ntvc.ac.ke', password: adminPassword, role: 'ADMIN' },
  });
  console.log(`✅ Admin user: admin@ntvc.ac.ke / Admin@NTVC2026`);

  // Create finance user
  const financePassword = await bcrypt.hash('Finance@NTVC2026', 12);
  await prisma.user.upsert({
    where: { email: 'finance@ntvc.ac.ke' },
    update: {},
    create: { email: 'finance@ntvc.ac.ke', password: financePassword, role: 'FINANCE' },
  });
  console.log(`✅ Finance user: finance@ntvc.ac.ke / Finance@NTVC2026`);

  // Seed departments and courses
  for (const dept of departments) {
    const { courses, ...deptData } = dept;
    const createdDept = await prisma.department.upsert({
      where: { slug: deptData.slug },
      update: { ...deptData },
      create: { ...deptData },
    });

    for (const course of courses) {
      await prisma.course.upsert({
        where: { id: `${createdDept.id}-${course.name}`.slice(0, 36) },
        update: { name: course.name, levels: course.levels, shortcode: course.shortcode },
        create: {
          name: course.name,
          levels: course.levels,
          shortcode: course.shortcode,
          department_id: createdDept.id,
        },
      });
    }
    console.log(`✅ Department seeded: ${deptData.name} (${courses.length} courses)`);
  }

  console.log('\n🎉 Seeding complete!');
  console.log('Admin credentials:  admin@ntvc.ac.ke / Admin@NTVC2026');
  console.log('Finance credentials: finance@ntvc.ac.ke / Finance@NTVC2026');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
