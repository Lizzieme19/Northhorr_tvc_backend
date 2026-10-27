const fs = require('fs');
const path = require('path');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const prisma = require('../config/db');
const { s3Client, BUCKET_NAME } = require('../config/s3');
const { uploadToS3 } = require('../middleware/upload');
const {
  generateAdmissionLetter,
  generateLetterOfAcceptance,
  generateAdmissionForTraining,
  generateStudentPersonalInfo,
} = require('./documentService');

// Documents the college issues to individual students. Each one is built from the template the
// admin saved under Doc Templates (document_type) and stored as a PDF.
// Fee Structure is deliberately absent: it is a public document published under Resources.
const STUDENT_DOCUMENTS = {
  'admission-letter': {
    type: 'ADMISSION_LETTER',
    label: 'Admission Letter',
    filePrefix: 'Admission_Letter',
    generate: async (student) => generateAdmissionLetter(student, await prisma.feeType.findMany({ where: { is_active: true } })),
  },
  'letter-of-acceptance': {
    type: 'ACCEPTANCE_LETTER',
    label: 'Letter of Acceptance',
    filePrefix: 'Letter_of_Acceptance',
    generate: (student) => generateLetterOfAcceptance(student),
  },
  'admission-for-training': {
    type: 'TRAINING_ADMISSION',
    label: 'Admission for Training',
    filePrefix: 'Admission_for_Training',
    generate: (student) => generateAdmissionForTraining(student),
  },
  'personal-information': {
    type: 'PERSONAL_INFO',
    label: 'Student Personal Information',
    filePrefix: 'Student_Personal_Information',
    generate: (student) => generateStudentPersonalInfo(student),
  },
};

const SLUGS = Object.keys(STUDENT_DOCUMENTS);

const safeAdmissionNo = (student) => student.admission_no.replace(/\//g, '_');
const downloadFileName = (student, slug) => `${STUDENT_DOCUMENTS[slug].filePrefix}_${safeAdmissionNo(student)}.pdf`;

// The generators read application, course and department
const loadStudentForDocuments = (where) =>
  prisma.student.findUnique({
    where,
    include: { application: true, course: true, department: true },
  });

// The issued copy of a document, if any. Admission letters generated before StudentDocument
// existed live in the old AdmissionLetter table and still count as issued.
const findIssued = async (studentId, slug) => {
  const { type } = STUDENT_DOCUMENTS[slug];
  const doc = await prisma.studentDocument.findUnique({
    where: { student_id_document_type: { student_id: studentId, document_type: type } },
  });
  if (doc) return doc;

  if (type === 'ADMISSION_LETTER') {
    const legacy = await prisma.admissionLetter.findUnique({ where: { student_id: studentId } });
    if (legacy) {
      return { file_key: null, file_url: legacy.letter_url, generated_at: legacy.generated_at, generated_by: legacy.generated_by, legacy: true };
    }
  }
  return null;
};

// Issue (build + save) a document. Without `regenerate`, an already-issued document is left alone.
const issueDocument = async (student, slug, userId, { regenerate = false } = {}) => {
  const def = STUDENT_DOCUMENTS[slug];

  if (!regenerate) {
    const existing = await findIssued(student.id, slug);
    if (existing) return { document: existing, created: false };
  }

  // Uses the template as it is saved right now
  const buffer = await def.generate(student);
  const { key, url } = await uploadToS3(buffer, downloadFileName(student, slug), `student-documents/${slug}`);

  const now = new Date();
  // upsert on the (student, type) unique pair, so simultaneous requests can't collide
  const document = await prisma.studentDocument.upsert({
    where: { student_id_document_type: { student_id: student.id, document_type: def.type } },
    update: { file_key: key, file_url: url, generated_by: userId, generated_at: now },
    create: { student_id: student.id, document_type: def.type, file_key: key, file_url: url, generated_by: userId, generated_at: now },
  });
  return { document, created: true };
};

// Status of every student document for one student
const listForStudent = async (studentId) => {
  const rows = await Promise.all(SLUGS.map(async (slug) => {
    const issued = await findIssued(studentId, slug);
    return {
      slug,
      type: STUDENT_DOCUMENTS[slug].type,
      label: STUDENT_DOCUMENTS[slug].label,
      issued: Boolean(issued),
      generated_at: issued?.generated_at || null,
    };
  }));
  return rows;
};

// Bytes of a stored document: S3 object, or the local-disk copy used when S3 was unreachable
const readStoredFile = async ({ file_key, file_url }) => {
  if (file_key && path.isAbsolute(file_key)) return fs.promises.readFile(file_key);

  let key = file_key;
  if (!key && file_url) {
    const u = new URL(file_url);
    if (u.hostname.endsWith('amazonaws.com')) {
      key = decodeURIComponent(u.pathname.slice(1));
    } else {
      // Legacy local fallback: <FRONTEND_URL>/<folder>/<file> maps to <backend>/public/<folder>/<file>
      const publicDir = path.join(__dirname, '../../public');
      const local = path.join(publicDir, decodeURIComponent(u.pathname));
      if (!local.startsWith(publicDir + path.sep)) throw new Error('Invalid stored file path');
      return fs.promises.readFile(local);
    }
  }

  const out = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
  return Buffer.from(await out.Body.transformToByteArray());
};

module.exports = {
  STUDENT_DOCUMENTS,
  SLUGS,
  loadStudentForDocuments,
  findIssued,
  issueDocument,
  listForStudent,
  readStoredFile,
  downloadFileName,
};
