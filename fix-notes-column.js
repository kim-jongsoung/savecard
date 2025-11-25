const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function fixNotesColumn() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 room_availability 테이블 구조 확인 중...');
    
    // 현재 컬럼 확인
    const checkColumn = await client.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'room_availability' 
        AND column_name = 'notes'
    `);
    
    if (checkColumn.rows.length > 0) {
      console.log('✅ notes 컬럼이 존재합니다:');
      console.log(checkColumn.rows[0]);
      
      // 데이터 타입 확인
      const col = checkColumn.rows[0];
      if (col.data_type !== 'text' && col.data_type !== 'character varying') {
        console.log('⚠️ notes 컬럼 타입이 올바르지 않습니다. 수정 중...');
        await client.query(`ALTER TABLE room_availability ALTER COLUMN notes TYPE TEXT`);
        console.log('✅ notes 컬럼 타입을 TEXT로 변경했습니다.');
      }
    } else {
      console.log('❌ notes 컬럼이 없습니다. 추가 중...');
      await client.query(`
        ALTER TABLE room_availability 
        ADD COLUMN notes TEXT DEFAULT ''
      `);
      console.log('✅ notes 컬럼을 추가했습니다.');
    }
    
    // 테스트 데이터 확인
    console.log('\n🔍 테스트 데이터 조회 중...');
    const testData = await client.query(`
      SELECT id, room_type_id, availability_date, available_rooms, notes
      FROM room_availability
      LIMIT 5
    `);
    console.log('✅ 데이터 조회 성공:');
    console.log(testData.rows);
    
    console.log('\n✅ notes 컬럼 수정 완료!');
    
  } catch (error) {
    console.error('❌ 에러 발생:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

fixNotesColumn();
