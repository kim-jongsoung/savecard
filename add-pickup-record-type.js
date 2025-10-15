require('dotenv').config({ path: './railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function addRecordTypeColumn() {
  try {
    console.log('🔧 픽업 테이블에 출도착 컬럼 추가 중...');
    
    // record_type 컬럼 추가 (departure: 출발, arrival: 도착)
    await pool.query(`
      ALTER TABLE airport_pickups 
      ADD COLUMN IF NOT EXISTS record_type VARCHAR(20) DEFAULT 'arrival';
    `);
    console.log('✅ record_type 컬럼 추가 완료');
    
    // display_date와 display_time 컬럼 추가 (달력 표시용)
    await pool.query(`
      ALTER TABLE airport_pickups 
      ADD COLUMN IF NOT EXISTS display_date DATE,
      ADD COLUMN IF NOT EXISTS display_time TIME;
    `);
    console.log('✅ display_date, display_time 컬럼 추가 완료');
    
    // 출발/도착 상세 정보 컬럼
    await pool.query(`
      ALTER TABLE airport_pickups 
      ADD COLUMN IF NOT EXISTS departure_date DATE,
      ADD COLUMN IF NOT EXISTS departure_time TIME,
      ADD COLUMN IF NOT EXISTS departure_airport VARCHAR(10),
      ADD COLUMN IF NOT EXISTS arrival_date DATE,
      ADD COLUMN IF NOT EXISTS arrival_time TIME,
      ADD COLUMN IF NOT EXISTS arrival_airport VARCHAR(10);
    `);
    console.log('✅ 출발/도착 상세 정보 컬럼 추가 완료');
    
    // linked_id 컬럼 추가 (출발/도착 레코드 연결용)
    await pool.query(`
      ALTER TABLE airport_pickups 
      ADD COLUMN IF NOT EXISTS linked_id INTEGER;
    `);
    console.log('✅ linked_id 컬럼 추가 완료');
    
    // 인덱스 추가
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_display_date ON airport_pickups(display_date);
      CREATE INDEX IF NOT EXISTS idx_record_type ON airport_pickups(record_type);
      CREATE INDEX IF NOT EXISTS idx_linked_id ON airport_pickups(linked_id);
    `);
    console.log('✅ 인덱스 추가 완료');
    
    console.log('🎉 픽업 테이블 업데이트 완료!');
    console.log('📝 추가된 컬럼: record_type, display_date, display_time, departure_date, departure_time, departure_airport, arrival_date, arrival_time, arrival_airport, linked_id');
    
  } catch (error) {
    console.error('❌ 오류:', error);
  } finally {
    await pool.end();
  }
}

addRecordTypeColumn();
