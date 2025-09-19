/**
 * Booking Management Server
 * Complete reservation management system with OpenAI parsing
 */

const express = require('express');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
require('dotenv').config();

// Import utilities and services
const { pool, dbMode, testConnection, createTables, ensureAllColumns } = require('./database');
const { runMigrations } = require('./run-migrations');
const { setupSSE } = require('./utils/sse');
const { errorHandler, asyncHandler } = require('./utils/errors');
const NotifyService = require('./services/notifyService');

// Import route handlers
const bookingsListRouter = require('./routes/bookings.list');
const bookingsDetailRouter = require('./routes/bookings.detail');
const bookingsPatchRouter = require('./routes/bookings.patch');
const bookingsCreateRouter = require('./routes/bookings.create');
const bookingsDeleteRouter = require('./routes/bookings.delete');
const bookingsBulkRouter = require('./routes/bookings.bulk');
const fieldDefsRouter = require('./routes/fieldDefs');
const auditsRouter = require('./routes/audits');

const app = express();
const PORT = process.env.NODE_ENV === 'production' ? process.env.PORT : 3001;

// Initialize services
const notifyService = new NotifyService();

// Middleware setup
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));
app.use('/pa', express.static('pa'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session configuration
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'booking-management-secret-2025',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
};

if (process.env.NODE_ENV === 'production') {
    sessionConfig.name = 'sessionId';
    sessionConfig.proxy = true;
}

app.use(session(sessionConfig));

// Add services to app locals
app.locals.pool = pool;
app.locals.dbMode = dbMode;
app.locals.notifyService = notifyService;

// Setup SSE for real-time updates
const sseManager = setupSSE(app);

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.adminId || req.headers['x-api-key'] === process.env.API_KEY) {
        next();
    } else {
        res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
}

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    req.requestId = requestId;
    req.startTime = start;
    
    // Log request
    console.log(`📥 ${req.method} ${req.url} [${requestId}]`);
    
    // Log response
    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;
        const statusEmoji = status < 400 ? '✅' : status < 500 ? '⚠️' : '❌';
        
        console.log(`📤 ${statusEmoji} ${status} ${req.method} ${req.url} [${requestId}] ${duration}ms`);
    });
    
    next();
});

// Health check endpoint
app.get('/healthz', asyncHandler(async (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        database: {
            mode: dbMode,
            connected: false
        },
        services: {
            sse: {
                clients: sseManager.clients.size,
                active: sseManager.getStats().active_clients
            },
            notifications: {
                email: !!notifyService.emailTransporter,
                kakao: !!notifyService.kakaoAdapter
            }
        }
    };

    // Test database connection
    try {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT NOW() as current_time');
            health.database.connected = true;
            health.database.current_time = result.rows[0].current_time;
        } else {
            health.database.connected = true;
            health.database.note = 'JSON mode';
        }
    } catch (error) {
        health.status = 'degraded';
        health.database.error = error.message;
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
}));

// API Routes
app.use('/api/bookings', requireAuth, bookingsListRouter);
app.use('/api/bookings', requireAuth, bookingsDetailRouter);
app.use('/api/bookings', requireAuth, bookingsPatchRouter);
app.use('/api/bookings', requireAuth, bookingsCreateRouter);
app.use('/api/bookings', requireAuth, bookingsDeleteRouter);
app.use('/api/bookings', requireAuth, bookingsBulkRouter);
app.use('/api/field-defs', requireAuth, fieldDefsRouter);
app.use('/api/audits', requireAuth, auditsRouter);

// Legacy compatibility routes (for existing admin system)
app.use('/bookings', requireAuth, bookingsListRouter);
app.use('/bookings', requireAuth, bookingsDetailRouter);
app.use('/bookings', requireAuth, bookingsPatchRouter);
app.use('/bookings', requireAuth, bookingsCreateRouter);
app.use('/bookings', requireAuth, bookingsDeleteRouter);
app.use('/bookings', requireAuth, bookingsBulkRouter);

// Import booking endpoint (integration with existing parsing system)
app.post('/import-booking', requireAuth, asyncHandler(async (req, res) => {
    const { raw_text, parsed_data, parsing_method = 'openai', confidence = 0.8 } = req.body;
    
    if (!parsed_data) {
        return res.status(400).json({
            success: false,
            message: 'parsed_data is required'
        });
    }

    // Forward to create booking endpoint
    req.body = {
        ...parsed_data,
        _raw_text: raw_text,
        review_status: confidence >= 0.9 ? 'reviewed' : 'needs_review'
    };
    
    req.headers['x-parsing-method'] = parsing_method;
    req.headers['x-confidence'] = confidence.toString();
    
    // Use the create booking handler
    const createHandler = require('./routes/bookings.create');
    return createHandler.handle(req, res);
}));

// Save parsed booking endpoint (legacy compatibility)
app.post('/bookings/save-parsed', requireAuth, asyncHandler(async (req, res) => {
    // Redirect to import-booking
    return app.handle({
        ...req,
        url: '/import-booking',
        method: 'POST'
    }, res);
}));

// SSE status endpoint
app.get('/api/sse/status', requireAuth, (req, res) => {
    res.json({
        success: true,
        data: sseManager.getStats()
    });
});

// Database management endpoints
app.get('/api/system/migrate', requireAuth, asyncHandler(async (req, res) => {
    if (dbMode !== 'postgresql') {
        return res.status(400).json({
            success: false,
            message: 'Migrations only available in PostgreSQL mode'
        });
    }

    try {
        await runMigrations();
        res.json({
            success: true,
            message: 'Migrations completed successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Migration failed',
            error: error.message
        });
    }
}));

// System info endpoint
app.get('/api/system/info', requireAuth, (req, res) => {
    res.json({
        success: true,
        data: {
            version: process.env.npm_package_version || '1.0.0',
            node_version: process.version,
            environment: process.env.NODE_ENV || 'development',
            database_mode: dbMode,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            features: {
                openai_parsing: !!process.env.OPENAI_API_KEY,
                email_notifications: !!process.env.SMTP_HOST,
                sse_enabled: true,
                audit_logging: true
            }
        }
    });
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found',
        available_endpoints: [
            'GET /healthz',
            'GET /events (SSE)',
            'GET /api/bookings',
            'POST /api/bookings',
            'GET /api/bookings/:id',
            'PATCH /api/bookings/:id',
            'DELETE /api/bookings/:id',
            'POST /api/bookings/bulk',
            'GET /api/field-defs',
            'POST /api/field-defs',
            'GET /api/audits/recent',
            'POST /import-booking'
        ]
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 SIGTERM received, shutting down gracefully...');
    sseManager.shutdown();
    if (pool) {
        pool.end(() => {
            console.log('💾 Database pool closed');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

process.on('SIGINT', () => {
    console.log('🔄 SIGINT received, shutting down gracefully...');
    sseManager.shutdown();
    if (pool) {
        pool.end(() => {
            console.log('💾 Database pool closed');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

// Initialize and start server
async function startServer() {
    try {
        console.log('🚀 Starting Booking Management Server...');
        
        // Test database connection
        await testConnection();
        
        // Run migrations if in PostgreSQL mode
        if (dbMode === 'postgresql') {
            console.log('🔧 Running database migrations...');
            try {
                await runMigrations();
                console.log('✅ Migrations completed');
            } catch (migrationError) {
                console.warn('⚠️ Migration warning:', migrationError.message);
            }
            
            // Ensure all columns exist
            await ensureAllColumns();
        }
        
        // Start server
        app.listen(PORT, () => {
            console.log('🎉 Booking Management Server started successfully!');
            console.log(`📍 Server running on port ${PORT}`);
            console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`💾 Database mode: ${dbMode}`);
            console.log(`📡 SSE endpoint: http://localhost:${PORT}/events`);
            console.log(`🏥 Health check: http://localhost:${PORT}/healthz`);
            
            // Send startup event
            sseManager.sendSystemEvent('startup', {
                message: 'Booking Management Server started',
                version: process.env.npm_package_version || '1.0.0',
                database_mode: dbMode,
                port: PORT
            });
        });
        
    } catch (error) {
        console.error('💥 Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
if (require.main === module) {
    startServer();
}

module.exports = app;
