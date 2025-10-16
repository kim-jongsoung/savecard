const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createClosedDatesTable() {
  try {
    console.log('🔧 픽업 마감날짜 테이블 생성 시작...');
    
    // pickup_closed_dates 테이블 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pickup_closed_dates (
        id SERIAL PRIMARY KEY,
        closed_date DATE NOT NULL UNIQUE,
        reason TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ pickup_closed_dates 테이블 생성 완료');
    
    // 인덱스 생성
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_closed_date 
      ON pickup_closed_dates(closed_date)
    `);
    
    console.log('✅ 인덱스 생성 완료');
    
    // 테이블 확인
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'pickup_closed_dates'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📋 테이블 구조:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    console.log('\n✅ 마감날짜 테이블 생성 완료!');
  } catch (error) {
    console.error('❌ 테이블 생성 실패:', error);
  } finally {
    await pool.end();
  }
}

createClosedDatesTable();
