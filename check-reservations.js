require('dotenv').config({ path: './railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkReservations() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 최근 예약 10건 확인\n');
        
        const result = await client.query(`
            SELECT 
                id, 
                reservation_number, 
                korean_name,
                status,
                check_in_date,
                assignment_token,
                created_at
            FROM hotel_reservations 
            ORDER BY id DESC 
            LIMIT 10
        `);
        
        console.log('총', result.rows.length, '건\n');
        result.rows.forEach(r => {
            console.log(`ID: ${r.id} | ${r.korean_name} | ${r.status} | 체크인: ${r.check_in_date} | 토큰: ${r.assignment_token ? '있음' : '없음'}`);
        });

    } catch (err) {
        console.error('❌ 오류:', err.message);
    } finally {
        client.release();
        pool.end();
    }
}

checkReservations();
