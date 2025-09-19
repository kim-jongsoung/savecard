const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// UTF-8 인코딩 설정
process.env.NODE_OPTIONS = '--max-old-space-size=4096';
if (process.platform === 'win32') {
    process.env.CHCP = '65001'; // UTF-8 코드페이지
}

/**
 * Migration runner for PostgreSQL
 * Executes all SQL migration files in order
 */

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigrations() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Starting database migrations...');
        
        // Create migrations tracking table
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        // Get list of migration files
        const migrationsDir = path.join(__dirname, 'migrations');
        const migrationFiles = fs.readdirSync(migrationsDir)
            .filter(file => file.endsWith('.sql'))
            .sort();
        
        console.log(`📁 Found ${migrationFiles.length} migration files`);
        
        // Check which migrations have been applied
        const appliedResult = await client.query('SELECT version FROM schema_migrations');
        const appliedMigrations = new Set(appliedResult.rows.map(row => row.version));
        
        // Run pending migrations
        for (const file of migrationFiles) {
            const version = path.basename(file, '.sql');
            
            if (appliedMigrations.has(version)) {
                console.log(`⏭️  Skipping ${file} (already applied)`);
                continue;
            }
            
            console.log(`📝 Applying migration: ${file}`);
            
            const migrationSQL = fs.readFileSync(path.join(migrationsDir, file), { encoding: 'utf8' });
            
            try {
                await client.query('BEGIN');
                await client.query(migrationSQL);
                await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
                await client.query('COMMIT');
                
                console.log(`✅ Successfully applied: ${file}`);
            } catch (error) {
                await client.query('ROLLBACK');
                console.error(`❌ Failed to apply ${file}:`, error.message);
                throw error;
            }
        }
        
        console.log('🎉 All migrations completed successfully!');
        
    } catch (error) {
        console.error('💥 Migration failed:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run migrations if called directly
if (require.main === module) {
    runMigrations()
        .then(() => {
            console.log('✨ Migration process completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('💀 Migration process failed:', error);
            process.exit(1);
        });
}

module.exports = { runMigrations };
