const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function createHotelAssignmentHistoryTable() {
    const client = await pool.connect();
    
    try {
        console.log('🏨 호텔 수배서 이력 테이블 생성 중...');
        
        // 1. hotel_reservations에 assignment_token 추가
        await client.query(`
            ALTER TABLE hotel_reservations
            ADD COLUMN IF NOT EXISTS assignment_token VARCHAR(100) UNIQUE
        `);
        
        console.log('✅ hotel_reservations.assignment_token 추가 완료');
        
        // 2. hotel_assignment_history 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_assignment_history (
                id SERIAL PRIMARY KEY,
                reservation_id INTEGER NOT NULL REFERENCES hotel_reservations(id) ON DELETE CASCADE,
                assignment_type VARCHAR(20) NOT NULL CHECK (assignment_type IN ('NEW', 'REVISE', 'CANCEL')),
                revision_number INTEGER DEFAULT 0,
                sent_to_email VARCHAR(255) NOT NULL,
                sent_by VARCHAR(100) NOT NULL,
                sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
                email_message_id VARCHAR(255),
                assignment_link TEXT,
                changes_description TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        console.log('✅ hotel_assignment_history 테이블 생성 완료');
        
        // 3. 인덱스 생성
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_hotel_assignment_history_reservation_id
            ON hotel_assignment_history(reservation_id)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_hotel_assignment_history_sent_at
            ON hotel_assignment_history(sent_at DESC)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_hotel_reservations_assignment_token
            ON hotel_reservations(assignment_token)
        `);
        
        console.log('✅ 인덱스 생성 완료');
        
        console.log('🎉 호텔 수배서 이력 테이블 설정 완료!');
        
    } catch (error) {
        console.error('❌ 테이블 생성 오류:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
createHotelAssignmentHistoryTable()
    .then(() => {
        console.log('✅ 마이그레이션 완료');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ 마이그레이션 실패:', error);
        process.exit(1);
    });
