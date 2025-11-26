require('dotenv').config({ path: './railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkToken() {
    const client = await pool.connect();
    const token = '62d0118ac0fba446a43a82af9a691539f7cf0165af8dea60e063b2663471115b';
    
    try {
        console.log('🔍 토큰으로 예약 검색:', token);
        
        const result = await client.query(`
            SELECT id, reservation_number, assignment_token, status, korean_name
            FROM hotel_reservations 
            WHERE assignment_token = $1
        `, [token]);
        
        if (result.rows.length > 0) {
            console.log('✅ 예약 발견:');
            console.log(result.rows[0]);
        } else {
            console.log('❌ 해당 토큰의 예약이 없습니다.');
            
            // 모든 토큰 확인
            const allTokens = await client.query(`
                SELECT id, assignment_token 
                FROM hotel_reservations 
                WHERE assignment_token IS NOT NULL
                ORDER BY id DESC
                LIMIT 5
            `);
            console.log('\n📋 최근 토큰이 있는 예약 5건:');
            console.log(allTokens.rows);
        }

    } catch (err) {
        console.error('❌ 오류:', err.message);
    } finally {
        client.release();
        pool.end();
    }
}

checkToken();
