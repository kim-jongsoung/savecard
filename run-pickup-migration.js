const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// 데이터베이스 연결 (DATABASE_URL 환경변수 사용)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  console.log('🚀 픽업 항공편/업체 테이블 마이그레이션 시작...\n');
  
  try {
    // 마이그레이션 SQL 파일 읽기
    const sqlPath = path.join(__dirname, 'migrations', '004-pickup-flights-agencies.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('📄 SQL 파일 읽기 완료');
    console.log('=' .repeat(60));
    
    // SQL 실행
    await pool.query(sql);
    
    console.log('\n✅ 마이그레이션 성공!\n');
    console.log('생성된 테이블:');
    console.log('  - pickup_flights (항공편 관리)');
    console.log('  - pickup_agencies (업체 관리)');
    
    // 테이블 확인
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('pickup_flights', 'pickup_agencies')
      ORDER BY table_name
    `);
    
    console.log('\n📊 확인된 테이블:');
    result.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });
    
    // 샘플 데이터 확인
    const flights = await pool.query('SELECT COUNT(*) FROM pickup_flights');
    const agencies = await pool.query('SELECT COUNT(*) FROM pickup_agencies');
    
    console.log('\n📈 현재 데이터:');
    console.log(`  - pickup_flights: ${flights.rows[0].count}개`);
    console.log(`  - pickup_agencies: ${agencies.rows[0].count}개`);
    
    console.log('\n🎉 마이그레이션이 완료되었습니다!');
    console.log('이제 항공편 관리와 업체 관리를 정상적으로 사용할 수 있습니다.\n');
    
  } catch (error) {
    console.error('\n❌ 마이그레이션 실패:', error.message);
    console.error('\n에러 상세:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 실행
runMigration();
