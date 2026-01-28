const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
    try {
        console.log('🔄 패키지 예약 투숙객 테이블에 성별 컬럼 추가 중...');
        
        await pool.query(`
            ALTER TABLE package_reservation_guests 
            ADD COLUMN IF NOT EXISTS gender VARCHAR(10)
        `);
        
        await pool.query(`
            COMMENT ON COLUMN package_reservation_guests.gender IS '성별: 남자, 여자 (성인의 경우 필수)'
        `);
        
        console.log('✅ 성별 컬럼 추가 완료!');
        
        // 테이블 구조 확인
        const result = await pool.query(`
            SELECT column_name, data_type, character_maximum_length 
            FROM information_schema.columns 
            WHERE table_name = 'package_reservation_guests'
            ORDER BY ordinal_position
        `);
        
        console.log('\n📋 package_reservation_guests 테이블 구조:');
        result.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type}${row.character_maximum_length ? `(${row.character_maximum_length})` : ''}`);
        });
        
    } catch (error) {
        console.error('❌ 마이그레이션 실패:', error);
    } finally {
        await pool.end();
    }
}

runMigration();
