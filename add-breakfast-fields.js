const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addBreakfastFields() {
    const client = await pool.connect();
    
    try {
        console.log('🍳 hotel_reservation_rooms 테이블에 조식 필드 추가 중...');
        
        await client.query(`
            ALTER TABLE hotel_reservation_rooms
            ADD COLUMN IF NOT EXISTS breakfast_included BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS breakfast_days INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS breakfast_adult_price DECIMAL(10,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS breakfast_child_price DECIMAL(10,2) DEFAULT 0
        `);
        
        console.log('✅ 조식 필드 추가 완료!');
        console.log('   - breakfast_included: BOOLEAN (조식 포함 여부)');
        console.log('   - breakfast_days: INTEGER (조식 제공 횟수/일수)');
        console.log('   - breakfast_adult_price: DECIMAL (성인 조식 단가)');
        console.log('   - breakfast_child_price: DECIMAL (소아 조식 단가)');
        
    } catch (error) {
        console.error('❌ 조식 필드 추가 실패:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
addBreakfastFields()
    .then(() => {
        console.log('🎉 마이그레이션 완료!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 마이그레이션 실패:', error);
        process.exit(1);
    });
