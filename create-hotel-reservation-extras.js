const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드 (railsql.env 우선)
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다 (로컬 Railway 연동)');
    require('dotenv').config({ path: './railsql.env' });
} else {
    console.log('🔧 기본 .env 파일을 사용합니다');
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createHotelReservationExtras() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🏨 hotel_reservation_extras 테이블 생성 시작...\n');
        
        // 추가 항목 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_reservation_extras (
                id SERIAL PRIMARY KEY,
                reservation_id INTEGER REFERENCES hotel_reservations(id) ON DELETE CASCADE,
                
                -- 항목 정보
                item_name VARCHAR(200) NOT NULL,
                item_type VARCHAR(50) DEFAULT 'other',
                quantity INTEGER DEFAULT 1,
                
                -- 인원별 요금 (선택적 - 공항픽업 등)
                adult_count INTEGER DEFAULT 0,
                adult_price DECIMAL(10,2) DEFAULT 0,
                child_count INTEGER DEFAULT 0,
                child_price DECIMAL(10,2) DEFAULT 0,
                infant_count INTEGER DEFAULT 0,
                infant_price DECIMAL(10,2) DEFAULT 0,
                
                -- 일반 단가 (인원 무관 - 꽃바구니 등)
                unit_price DECIMAL(10,2) DEFAULT 0,
                
                -- 요금 계산
                total_selling_price DECIMAL(10,2) NOT NULL,
                total_cost_price DECIMAL(10,2) DEFAULT 0,
                currency VARCHAR(10) DEFAULT 'USD',
                
                -- 메모
                notes TEXT,
                
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_reservation_extras 테이블 생성 완료');
        
        // 인덱스 생성
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_extras_reservation 
            ON hotel_reservation_extras(reservation_id)
        `);
        console.log('✅ 인덱스 생성 완료');
        
        await client.query('COMMIT');
        
        console.log('\n🎉 hotel_reservation_extras 테이블 생성 완료!\n');
        console.log('📋 용도:');
        console.log('  - 공항픽업 (인원별 요금)');
        console.log('  - 꽃바구니, 감사 편지 (단가)');
        console.log('  - 호텔 시설 이용 (동적 추가)\n');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 테이블 생성 오류:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
if (require.main === module) {
    createHotelReservationExtras()
        .then(() => {
            console.log('✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { createHotelReservationExtras };
