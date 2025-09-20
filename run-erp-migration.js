const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// 환경변수에서 데이터베이스 URL 가져오기
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/guamsavecard';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 ERP 확장 마이그레이션 시작...');
        
        // migration_log 테이블이 없으면 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS migration_log (
                id SERIAL PRIMARY KEY,
                version VARCHAR(10) UNIQUE NOT NULL,
                description TEXT,
                executed_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        // 이미 실행된 마이그레이션인지 확인
        const existingMigration = await client.query(
            'SELECT * FROM migration_log WHERE version = $1',
            ['002']
        );
        
        if (existingMigration.rows.length > 0) {
            console.log('⚠️  마이그레이션 002는 이미 실행되었습니다.');
            return;
        }
        
        // 마이그레이션 SQL 파일 읽기
        const migrationSQL = fs.readFileSync(
            path.join(__dirname, 'migrations', '002-erp-expansion.sql'),
            'utf8'
        );
        
        // 트랜잭션으로 마이그레이션 실행
        await client.query('BEGIN');
        
        console.log('📋 마이그레이션 SQL 실행 중...');
        await client.query(migrationSQL);
        
        await client.query('COMMIT');
        
        console.log('✅ ERP 확장 마이그레이션 완료!');
        
        // 생성된 테이블 확인
        const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('field_defs', 'reservation_audits', 'assignments', 'purchase_lines', 'sales_lines', 'settlements')
            ORDER BY table_name
        `);
        
        console.log('📊 생성된 테이블들:');
        tables.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}`);
        });
        
        // extras 컬럼 확인
        const extrasColumn = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'reservations' AND column_name = 'extras'
        `);
        
        if (extrasColumn.rows.length > 0) {
            console.log('   ✓ reservations.extras (JSONB)');
        }
        
        // field_defs 기본 데이터 확인
        const fieldDefsCount = await client.query('SELECT COUNT(*) FROM field_defs');
        console.log(`   ✓ field_defs 기본 데이터: ${fieldDefsCount.rows[0].count}개`);
        
        console.log('\n🎉 ERP 시스템 준비 완료!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 마이그레이션 실패:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 스크립트 실행
if (require.main === module) {
    runMigration()
        .then(() => {
            console.log('✨ 마이그레이션 스크립트 완료');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 마이그레이션 스크립트 실패:', error);
            process.exit(1);
        });
}

module.exports = { runMigration };
