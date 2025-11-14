const { Pool } = require('pg');

// ⭐ 여기에 Railway에서 복사한 DATABASE_URL을 붙여넣으세요
const DATABASE_URL = 'PASTE_YOUR_DATABASE_URL_HERE';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addPromotionFields() {
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
        
        // 확인
        const result = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'hotel_reservation_rooms' 
            AND column_name IN ('promotion_code', 'rate_condition_id', 'total_selling_price')
            ORDER BY column_name
        `);
        
        console.log('\n📋 추가된 컬럼 확인:');
        result.rows.forEach(row => {
            console.log(`   ${row.column_name}: ${row.data_type}`);
        });
        
    } catch (error) {
        console.error('❌ 필드 추가 실패:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

addPromotionFields()
    .then(() => {
        console.log('\n🎉 마이그레이션 완료!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 마이그레이션 실패:', error);
        process.exit(1);
    });
