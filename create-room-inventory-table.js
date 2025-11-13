const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다');
    require('dotenv').config({ path: './railsql.env' });
} else {
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createRoomInventoryTable() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('📦 객실 재고 테이블 생성 시작...\n');
        
        // room_inventory 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS room_inventory (
                id SERIAL PRIMARY KEY,
                hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
                room_type_id INTEGER REFERENCES room_types(id) ON DELETE CASCADE,
                inventory_date DATE NOT NULL,
                
                -- 재고 수량
                available_rooms INTEGER DEFAULT 0,
                allocated_rooms INTEGER DEFAULT 0,
                reserved_rooms INTEGER DEFAULT 0,
                
                -- 메모
                notes TEXT,
                
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                
                -- 중복 방지 (같은 날짜에 같은 호텔/객실타입은 1개만)
                UNIQUE(hotel_id, room_type_id, inventory_date)
            )
        `);
        console.log('✅ room_inventory 테이블 생성 완료');
        
        // 인덱스 생성
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_inventory_hotel_date 
            ON room_inventory(hotel_id, inventory_date)
        `);
        console.log('✅ 호텔+날짜 인덱스 생성');
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_inventory_room_type_date 
            ON room_inventory(room_type_id, inventory_date)
        `);
        console.log('✅ 객실타입+날짜 인덱스 생성');
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_inventory_date 
            ON room_inventory(inventory_date)
        `);
        console.log('✅ 날짜 인덱스 생성');
        
        await client.query('COMMIT');
        
        console.log('\n🎉 객실 재고 테이블 생성 완료!\n');
        console.log('📋 테이블 구조:');
        console.log('  - hotel_id (호텔)');
        console.log('  - room_type_id (객실 타입)');
        console.log('  - inventory_date (재고 날짜)');
        console.log('  - available_rooms (가능한 객실 수)');
        console.log('  - allocated_rooms (배정된 수)');
        console.log('  - reserved_rooms (예약된 수)');
        console.log('  - notes (메모)\n');
        
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
    createRoomInventoryTable()
        .then(() => {
            console.log('✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { createRoomInventoryTable };
