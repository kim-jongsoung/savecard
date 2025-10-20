const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드
if (fs.existsSync('./railsql.env')) {
    require('dotenv').config({ path: './railsql.env' });
} else {
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function addCostPriceColumn() {
    try {
        console.log('🔧 업체 원가 컬럼 추가 시작...\n');
        
        // 1. cost_price 컬럼 추가
        console.log('1️⃣ cost_price 컬럼 추가...');
        await pool.query(`
            ALTER TABLE pickup_agencies 
            ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10, 2) DEFAULT 0
        `);
        console.log('✅ 컬럼 추가 완료');
        
        // 2. 결과 확인
        console.log('\n2️⃣ 업체 정보 확인:');
        const result = await pool.query(`
            SELECT id, agency_name, agency_code, cost_price, is_active
            FROM pickup_agencies
            ORDER BY agency_name
        `);
        
        console.table(result.rows);
        
        console.log('\n✅ 업체 원가 컬럼 추가 완료!');
        console.log('이제 각 업체마다 원가(USD)를 기록할 수 있습니다.');
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
        console.error(error);
    } finally {
        await pool.end();
    }
}

addCostPriceColumn();
