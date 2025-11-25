const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkAndCreateTable() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 hotel_notices 테이블 확인 중...\n');
    
    // 1. 테이블 존재 확인
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'hotel_notices'
      )
    `);
    
    const tableExists = tableCheck.rows[0].exists;
    console.log(`테이블 존재 여부: ${tableExists ? '✅ 존재함' : '❌ 없음'}`);
    
    if (!tableExists) {
      console.log('\n🔧 hotel_notices 테이블 생성 중...');
      
      // 테이블 생성
      await client.query(`
        CREATE TABLE hotel_notices (
          id SERIAL PRIMARY KEY,
          hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
          notice_text TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          created_by VARCHAR(100),
          is_active BOOLEAN DEFAULT TRUE
        )
      `);
      console.log('✅ 테이블 생성 완료');
      
      // 인덱스 생성
      await client.query(`
        CREATE INDEX idx_hotel_notices_hotel_id ON hotel_notices(hotel_id)
      `);
      await client.query(`
        CREATE INDEX idx_hotel_notices_active ON hotel_notices(hotel_id, is_active)
      `);
      console.log('✅ 인덱스 생성 완료');
    }
    
    // 2. 테이블 구조 확인
    console.log('\n📊 테이블 구조:');
    const columns = await client.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'hotel_notices'
      ORDER BY ordinal_position
    `);
    
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''} ${col.column_default || ''}`);
    });
    
    // 3. 데이터 확인
    const dataCheck = await client.query('SELECT COUNT(*) FROM hotel_notices');
    console.log(`\n📝 현재 공지사항 개수: ${dataCheck.rows[0].count}개`);
    
    // 4. 호텔 목록 확인
    console.log('\n🏨 등록된 호텔:');
    const hotels = await client.query('SELECT id, hotel_name FROM hotels WHERE is_active = TRUE ORDER BY id');
    hotels.rows.forEach(h => {
      console.log(`  - [${h.id}] ${h.hotel_name}`);
    });
    
    console.log('\n✅ 모든 확인 완료!');
    
  } catch (error) {
    console.error('\n❌ 에러 발생:', error.message);
    console.error('상세:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkAndCreateTable();
