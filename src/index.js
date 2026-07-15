require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');

const authRoutes = require('./routes/auth.routes');
const applicationRoutes = require('./routes/applications.routes');
const studentRoutes = require('./routes/students.routes');
const admissionRoutes = require('./routes/admissions.routes');
const departmentRoutes = require('./routes/departments.routes');
const financeRoutes = require('./routes/finance.routes');
const courseRoutes = require('./routes/courses.routes');
const staffRoutes = require('./routes/staff.routes');
const designationsRoutes = require('./routes/designations.routes');
const leavesRoutes = require('./routes/leaves.routes');
const suppliersRoutes = require('./routes/suppliers.routes');
const requisitionsRoutes = require('./routes/requisitions.routes');
const rfqsRoutes = require('./routes/rfqs.routes');
const lposRoutes = require('./routes/lpos.routes');
const grnsRoutes = require('./routes/grns.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const invoicesRoutes = require('./routes/invoices.routes');
const assetsRoutes = require('./routes/assets.routes');
const budgetsRoutes = require('./routes/budgets.routes');
const auditRoutes = require('./routes/audit.routes');
const resourcesRoutes = require('./routes/resources.routes');

const app = express();

// Middleware
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  // Add your Render frontend URL here
  process.env.RENDER_FRONTEND_URL,
  // Allow the backend's own URL for Swagger UI
  process.env.RENDER_BACKEND_URL || 'https://northhorr-tvc-backend.onrender.com',
  'http://localhost:5000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins for now, restrict in production
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve local static files in case B2 fallback is used
const path = require('path');
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'NTVC Backend', timestamp: new Date().toISOString() });
});

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/admissions', admissionRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/designations', designationsRoutes);
app.use('/api/leaves', leavesRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/requisitions', requisitionsRoutes);
app.use('/api/rfqs', rfqsRoutes);
app.use('/api/lpos', lposRoutes);
app.use('/api/grns', grnsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/resources', resourcesRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`✅ NTVC Backend running on http://${HOST}:${PORT}`);
});

module.exports = app;
