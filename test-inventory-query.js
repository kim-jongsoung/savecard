const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function testInventoryAPI() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 재고 API 쿼리 테스트 중...\n');
    
    const hotel_id = 1;
    const year = 2025;
    const month = 11;
    
    const targetYear = year;
    const targetMonth = month;
    const startDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
    const endDate = new Date(targetYear, targetMonth, 0);
    const endDateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    
    console.log('📅 조회 기간:', startDate, '~', endDateStr);
    console.log('🏨 호텔 ID:', hotel_id);
    
    const query = `
      SELECT 
        ra.id,
        ra.room_type_id,
        ra.availability_date,
        ra.available_rooms,
        ra.notes,
        ra.created_at,
        ra.updated_at,
        h.hotel_name,
        h.hotel_code,
        rt.room_type_code,
        rt.room_type_name
      FROM room_availability ra
      LEFT JOIN room_types rt ON ra.room_type_id = rt.id
      LEFT JOIN hotels h ON rt.hotel_id = h.id
      WHERE ra.availability_date >= $1 AND ra.availability_date <= $2
        AND rt.hotel_id = $3
      ORDER BY ra.availability_date, h.hotel_name, rt.room_type_code
      LIMIT 5
    `;
    
    const result = await client.query(query, [startDate, endDateStr, hotel_id]);
    
    console.log(`\n✅ 쿼리 성공! ${result.rows.length}개 결과:\n`);
    result.rows.forEach(row => {
      console.log({
        id: row.id,
        room_type: row.room_type_name,
        date: row.availability_date.toISOString().split('T')[0],
        available_rooms: row.available_rooms,
        notes: row.notes || '(null)'
      });
    });
    
  } catch (error) {
    console.error('\n❌ 쿼리 실패:', error.message);
    console.error('상세:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

testInventoryAPI();
