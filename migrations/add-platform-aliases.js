const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addPlatformAliases() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 platforms 테이블에 aliases 컬럼 추가...');
        
        // aliases JSONB 컬럼 추가 (별칭 배열)
        await client.query(`
            ALTER TABLE platforms 
            ADD COLUMN IF NOT EXISTS aliases JSONB DEFAULT '[]'::jsonb;
        `);
        
        console.log('✅ aliases 컬럼 추가 완료');
        
        // 정산 정보 컬럼 제거
        console.log('🔧 불필요한 정산 정보 컬럼 제거...');
        
        await client.query(`
            ALTER TABLE platforms 
            DROP COLUMN IF EXISTS commission_rate,
            DROP COLUMN IF EXISTS settlement_cycle,
            DROP COLUMN IF EXISTS payment_terms;
        `);
        
        console.log('✅ 정산 정보 컬럼 제거 완료');
        
        console.log('🎉 마이그레이션 완료!');
        
    } catch (error) {
        console.error('❌ 마이그레이션 실패:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
addPlatformAliases().catch(console.error);
