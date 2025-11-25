const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkNotesData() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 notes 데이터 확인 중...\n');
    
    // 2025-11-13 데이터 확인
    const result = await client.query(`
      SELECT 
        id,
        room_type_id,
        availability_date,
        available_rooms,
        notes,
        updated_at
      FROM room_availability
      WHERE availability_date = '2025-11-13'
        AND room_type_id = 8
    `);
    
    console.log('✅ 2025-11-13, room_type_id=8 데이터:');
    console.log(result.rows);
    
    // HIGHLIGHT가 있는 모든 데이터 확인
    const highlighted = await client.query(`
      SELECT 
        id,
        room_type_id,
        availability_date,
        available_rooms,
        notes,
        updated_at
      FROM room_availability
      WHERE notes = 'HIGHLIGHT'
      ORDER BY availability_date
    `);
    
    console.log('\n🟡 notes="HIGHLIGHT"인 데이터:');
    if (highlighted.rows.length === 0) {
      console.log('❌ HIGHLIGHT 데이터가 없습니다!');
    } else {
      console.log(highlighted.rows);
    }
    
    // notes가 null이 아닌 모든 데이터
    const notNull = await client.query(`
      SELECT 
        id,
        room_type_id,
        availability_date,
        available_rooms,
        notes,
        updated_at
      FROM room_availability
      WHERE notes IS NOT NULL AND notes != ''
      ORDER BY availability_date
      LIMIT 10
    `);
    
    console.log('\n📝 notes가 있는 데이터:');
    console.log(notNull.rows);
    
  } catch (error) {
    console.error('❌ 에러:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkNotesData();
