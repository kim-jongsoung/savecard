const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function addRentalFields() {
  const client = await pool.connect();
  
  try {
    console.log('🚗 렌트카 정보 필드 추가 시작...');
    
    // 렌트카 정보 필드 추가
    await client.query(`
      ALTER TABLE airport_pickups 
      ADD COLUMN IF NOT EXISTS rental_vehicle VARCHAR(100),
      ADD COLUMN IF NOT EXISTS rental_number VARCHAR(50),
      ADD COLUMN IF NOT EXISTS rental_duration VARCHAR(50);
    `);
    console.log('✅ 렌트카 필드 추가 완료 (rental_vehicle, rental_number, rental_duration)');
    
    console.log('\n🎉 렌트카 정보 시스템 준비 완료!');
    console.log('\n📝 추가된 필드:');
    console.log('  ✓ rental_vehicle: 차량명 (예: K5, Avante)');
    console.log('  ✓ rental_number: 차량번호 (예: 12가3456)');
    console.log('  ✓ rental_duration: 대여시간 (예: 3시간, 24시간)');
    
  } catch (error) {
    console.error('❌ 필드 추가 실패:', error);
    console.error('상세 오류:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

addRentalFields();
