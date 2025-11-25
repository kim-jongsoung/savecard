const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkRoomTypes() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 room_types 테이블 구조 확인 중...');
    
    // room_types 컬럼 확인
    const columns = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns 
      WHERE table_name = 'room_types'
      ORDER BY ordinal_position
    `);
    
    console.log('✅ room_types 컬럼 목록:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // is_visible_in_inventory 컬럼 확인
    const hasColumn = columns.rows.find(c => c.column_name === 'is_visible_in_inventory');
    
    if (!hasColumn) {
      console.log('\n❌ is_visible_in_inventory 컬럼이 없습니다!');
      console.log('추가 중...');
      
      await client.query(`
        ALTER TABLE room_types 
        ADD COLUMN is_visible_in_inventory BOOLEAN DEFAULT TRUE
      `);
      
      console.log('✅ is_visible_in_inventory 컬럼 추가 완료');
    } else {
      console.log('\n✅ is_visible_in_inventory 컬럼이 존재합니다');
    }
    
  } catch (error) {
    console.error('❌ 에러 발생:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkRoomTypes();
