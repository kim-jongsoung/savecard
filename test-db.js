const { Pool } = require('pg');
require('dotenv').config();

console.log('🔍 데이터베이스 연결 테스트 시작...');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '설정됨' : '설정되지 않음');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function testConnection() {
  try {
    console.log('📡 PostgreSQL 연결 시도 중...');
    const client = await pool.connect();
    console.log('✅ PostgreSQL 연결 성공!');
    
    // 기본 쿼리 테스트
    const result = await client.query('SELECT NOW() as current_time');
    console.log('⏰ 서버 시간:', result.rows[0].current_time);
    
    // 테이블 존재 확인
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    console.log('📋 현재 테이블 목록:');
    tables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    client.release();
    await pool.end();
    
    console.log('🎉 데이터베이스 연결 테스트 완료!');
    
  } catch (err) {
    console.error('❌ 데이터베이스 연결 실패:', err.message);
    console.error('상세 오류:', err);
    process.exit(1);
  }
}

testConnection();
