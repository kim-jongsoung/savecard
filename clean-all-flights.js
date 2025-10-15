const { Pool } = require('pg');

// 데이터베이스 연결
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function cleanAllFlights() {
  console.log('🚀 모든 항공편 데이터 삭제 시작...\n');
  
  try {
    // 1. 현재 항공편 확인
    const beforeResult = await pool.query(`
      SELECT flight_number, airline, departure_airport, arrival_airport, is_active
      FROM pickup_flights 
      ORDER BY flight_number
    `);
    
    console.log(`📊 현재 등록된 항공편: ${beforeResult.rows.length}개\n`);
    
    if (beforeResult.rows.length > 0) {
      console.log('🗑️  삭제할 항공편 목록:');
      beforeResult.rows.forEach(row => {
        console.log(`  - ${row.flight_number} (${row.airline}): ${row.departure_airport} → ${row.arrival_airport} [${row.is_active ? '활성' : '비활성'}]`);
      });
      console.log('');
      
      // 2. 픽업건에서 사용 중인지 확인
      const usageCheck = await pool.query(`
        SELECT flight_number, COUNT(*) as count
        FROM airport_pickups
        WHERE flight_number IN (SELECT flight_number FROM pickup_flights)
        GROUP BY flight_number
      `);
      
      if (usageCheck.rows.length > 0) {
        console.log('⚠️  픽업건에서 사용 중인 항공편:');
        usageCheck.rows.forEach(row => {
          console.log(`  - ${row.flight_number}: ${row.count}건`);
        });
        console.log('\n💡 픽업건의 flight_number를 유지하되, pickup_flights 테이블만 정리합니다.\n');
      }
      
      // 3. 모든 항공편 삭제
      const deleteResult = await pool.query(`
        DELETE FROM pickup_flights
        RETURNING flight_number
      `);
      
      console.log(`✅ ${deleteResult.rowCount}개의 항공편이 삭제되었습니다!\n`);
    } else {
      console.log('✅ 이미 항공편 데이터가 없습니다.\n');
    }
    
    // 4. 확인
    const afterResult = await pool.query(`SELECT COUNT(*) FROM pickup_flights`);
    console.log(`📈 현재 항공편 데이터: ${afterResult.rows[0].count}개\n`);
    
    console.log('🎉 완료! 이제 항공편 관리 페이지에서 필요한 항공편만 추가하세요.\n');
    
  } catch (error) {
    console.error('\n❌ 삭제 실패:', error.message);
    
    if (error.code === '23503') {
      console.error('\n💡 외래키 제약조건 에러입니다.');
      console.error('해결 방법: 먼저 airport_pickups에서 해당 항공편을 사용하는 레코드를 삭제하거나');
      console.error('flight_number를 NULL로 변경한 후 다시 시도하세요.\n');
    }
    
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 실행
cleanAllFlights();
