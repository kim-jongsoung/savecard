const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addBreakfastFields() {
    const client = await pool.connect();
    
    try {
        console.log('🏨 hotel_reservation_rooms 테이블에 프로모션 필드 추가 중...');
        
        await client.query(`
            ALTER TABLE hotel_reservation_rooms
            ADD COLUMN IF NOT EXISTS promotion_code VARCHAR(50),
            ADD COLUMN IF NOT EXISTS rate_condition_id INTEGER,
            ADD COLUMN IF NOT EXISTS total_selling_price DECIMAL(10,2) DEFAULT 0
        `);
        
        console.log('✅ 프로모션 필드 추가 완료!');
        console.log('   - promotion_code: VARCHAR(50) (프로모션 코드)');
        console.log('   - rate_condition_id: INTEGER (요금 조건 ID)');
        console.log('   - total_selling_price: DECIMAL (객실 총 판매가)');
        
    } catch (error) {
        console.error('❌ 필드 추가 실패:', error);
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
