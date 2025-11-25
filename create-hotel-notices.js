const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function createHotelNotices() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 hotel_notices 테이블 생성 중...\n');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS hotel_notices (
        id SERIAL PRIMARY KEY,
        hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        notice_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        created_by VARCHAR(100),
        is_active BOOLEAN DEFAULT TRUE
      )
    `);
    
    console.log('✅ hotel_notices 테이블 생성 완료');
    
    // 인덱스 생성
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hotel_notices_hotel_id 
      ON hotel_notices(hotel_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hotel_notices_active 
      ON hotel_notices(hotel_id, is_active)
    `);
    
    console.log('✅ 인덱스 생성 완료');
    
    // 테스트 데이터 확인
    const result = await client.query('SELECT * FROM hotel_notices LIMIT 5');
    console.log(`\n📊 현재 공지사항: ${result.rows.length}개`);
    
  } catch (error) {
    console.error('❌ 에러:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

createHotelNotices();
