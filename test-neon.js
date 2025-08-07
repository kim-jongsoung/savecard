// Neon PostgreSQL 연결 테스트
const { Pool } = require('pg');

async function testNeonConnection() {
    // Neon에서 제공받은 DATABASE_URL을 여기에 입력하세요
    const DATABASE_URL = 'postgresql://username:password@hostname/database';
    
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('🔄 Neon PostgreSQL 연결 테스트 중...');
        
        const client = await pool.connect();
        console.log('✅ Neon 데이터베이스 연결 성공!');
        
        // 테스트 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS test_table (
                id SERIAL PRIMARY KEY,
                message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 테스트 데이터 삽입
        await client.query(`
            INSERT INTO test_table (message) 
            VALUES ('괌세이브카드 DB 테스트 성공!')
        `);
        
        // 데이터 조회
        const result = await client.query('SELECT * FROM test_table ORDER BY id DESC LIMIT 1');
        console.log('📊 테스트 결과:', result.rows[0]);
        
        client.release();
        console.log('🎉 Neon PostgreSQL 완벽 작동!');
        
    } catch (error) {
        console.error('❌ 연결 실패:', error.message);
        console.log('💡 해결 방법:');
        console.log('1. DATABASE_URL이 올바른지 확인');
        console.log('2. Neon 프로젝트가 활성화되어 있는지 확인');
        console.log('3. 네트워크 연결 상태 확인');
    } finally {
        await pool.end();
    }
}

// 테스트 실행
testNeonConnection();
