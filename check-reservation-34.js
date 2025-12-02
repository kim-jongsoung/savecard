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
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkReservation() {
    try {
        const result = await pool.query(`
            SELECT 
                id, 
                reservation_number, 
                status,
                payment_received_date,
                payment_sent_date,
                check_in_date,
                hotel_id,
                booking_agency_id
            FROM hotel_reservations 
            WHERE id = 34
        `);
        
        console.log('🔍 예약 ID 34 정보:');
        console.log(JSON.stringify(result.rows[0], null, 2));
        
        if (result.rows.length === 0) {
            console.log('❌ ID 34 예약이 존재하지 않습니다!');
        }
        
    } catch (error) {
        console.error('❌ 오류:', error);
    } finally {
        await pool.end();
    }
}

checkReservation();
