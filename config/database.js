const mysql = require('mysql2/promise');

// 데이터베이스 연결 설정
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'guam_savecard',
    charset: 'utf8mb4',
    timezone: '+09:00',
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true
};

// 연결 풀 생성
const pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 데이터베이스 연결 테스트
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ MySQL 데이터베이스 연결 성공');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ MySQL 데이터베이스 연결 실패:', error.message);
        return false;
    }
}

module.exports = {
    pool,
    testConnection
};
