const { Pool } = require('pg');

// PostgreSQL 연결 풀 생성
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/guamsavecard',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 데이터베이스 연결 테스트
async function testConnection() {
    try {
        const client = await pool.connect();
        console.log('✅ PostgreSQL 데이터베이스 연결 성공');
        client.release();
        return true;
    } catch (error) {
        console.error('❌ PostgreSQL 데이터베이스 연결 실패:', error.message);
        return false;
    }
}

module.exports = {
    pool,
    testConnection
};
