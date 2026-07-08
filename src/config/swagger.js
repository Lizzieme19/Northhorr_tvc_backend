const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'NTVC Backend API',
      version: '1.0.0',
      description: 'Northhorr Technical and Vocational College Backend API Documentation',
      contact: {
        name: 'NTVC Support',
        email: 'support@ntvc.ac.ke',
      },
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Development server',
      },
      {
        url: process.env.API_URL || 'https://api.ntvc.ac.ke',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { 
              type: 'string', 
              enum: ['STUDENT', 'ADMIN', 'DEPT_HEAD', 'FINANCE', 'STAFF', 'PROCUREMENT', 'HR'] 
            },
            mustChangePassword: { type: 'boolean' },
            studentId: { type: 'string' },
            admissionNo: { type: 'string' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js'],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
