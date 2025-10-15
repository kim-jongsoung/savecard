const { Pool } = require('pg');

// 데이터베이스 연결
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function removeSampleFlights() {
  console.log('🚀 샘플 항공편 데이터 삭제 시작...\n');
  
  try {
    // 삭제 전 확인
    const beforeCount = await pool.query(
      `SELECT COUNT(*) FROM pickup_flights WHERE flight_number IN ('UA200', 'UA201')`
    );
    
    console.log(`📊 삭제 전 샘플 데이터: ${beforeCount.rows[0].count}개`);
    
    if (beforeCount.rows[0].count === '0') {
      console.log('\n✅ 이미 샘플 데이터가 없습니다!\n');
      return;
    }
    
    // 샘플 데이터 확인
    const sampleData = await pool.query(
      `SELECT flight_number, airline, departure_airport, arrival_airport 
       FROM pickup_flights 
       WHERE flight_number IN ('UA200', 'UA201')`
    );
    
    console.log('\n🗑️  삭제할 항공편:');
    sampleData.rows.forEach(row => {
      console.log(`  - ${row.flight_number}: ${row.departure_airport} → ${row.arrival_airport} (${row.airline})`);
    });
    
    // 삭제 실행
    const deleteResult = await pool.query(
      `DELETE FROM pickup_flights 
       WHERE flight_number IN ('UA200', 'UA201')
         AND airline = 'United Airlines'
       RETURNING flight_number`
    );
    
    console.log(`\n✅ ${deleteResult.rowCount}개의 샘플 항공편이 삭제되었습니다!`);
    
    // 삭제 후 확인
    const afterCount = await pool.query(`SELECT COUNT(*) FROM pickup_flights`);
    console.log(`\n📈 현재 항공편 데이터: ${afterCount.rows[0].count}개\n`);
    
    console.log('🎉 완료! 이제 서버를 재시작해도 샘플 데이터가 생성되지 않습니다.\n');
    
  } catch (error) {
    console.error('\n❌ 삭제 실패:', error.message);
    console.error('\n에러 상세:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 실행
removeSampleFlights();
