const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function updatePickupFields() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 공항 픽업 테이블 업데이트 시작...');
    
    // 인원 상세 필드 추가
    await client.query(`
      ALTER TABLE airport_pickups 
      ADD COLUMN IF NOT EXISTS adult_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS child_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS infant_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS luggage_count INTEGER DEFAULT 0;
    `);
    console.log('✅ 인원/짐 필드 추가 완료');
    
    // 기존 passenger_count를 adult_count로 마이그레이션
    await client.query(`
      UPDATE airport_pickups 
      SET adult_count = COALESCE(passenger_count, 0)
      WHERE adult_count = 0 AND passenger_count > 0;
    `);
    console.log('✅ 기존 데이터 마이그레이션 완료');
    
    console.log('🎉 테이블 업데이트 완료!');
    
  } catch (error) {
    console.error('❌ 업데이트 실패:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

updatePickupFields();
