const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

console.log('🔧 Railway PostgreSQL 연결 테스트');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function testConnection() {
    try {
        console.log('🔄 연결 시도 중...');
        const client = await pool.connect();
        console.log('✅ Railway PostgreSQL 연결 성공!');
        
        const result = await client.query('SELECT NOW() as current_time');
        console.log('📅 현재 시간:', result.rows[0].current_time);
        
        client.release();
        await pool.end();
        
    } catch (error) {
        console.error('❌ 연결 실패:', error.message);
        console.error('오류 코드:', error.code);
        console.error('오류 상세:', error);
    }
}

testConnection();
