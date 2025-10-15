const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// 데이터베이스 연결
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addUpdatedAtColumns() {
  console.log('🚀 updated_at 컬럼 추가 시작...\n');
  
  try {
    // 마이그레이션 SQL 파일 읽기
    const sqlPath = path.join(__dirname, 'migrations', '005-add-updated-at-columns.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('📄 SQL 파일 읽기 완료');
    console.log('=' .repeat(60));
    
    // SQL 실행
    await pool.query(sql);
    
    console.log('\n✅ updated_at 컬럼 추가 성공!\n');
    
    // 컬럼 확인
    const agenciesCheck = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'pickup_agencies'
        AND column_name = 'updated_at'
    `);
    
    const flightsCheck = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'pickup_flights'
        AND column_name = 'updated_at'
    `);
    
    console.log('📊 확인된 컬럼:');
    if (agenciesCheck.rows.length > 0) {
      console.log('  ✓ pickup_agencies.updated_at:', agenciesCheck.rows[0].data_type);
    } else {
      console.log('  ⚠ pickup_agencies.updated_at: 없음');
    }
    
    if (flightsCheck.rows.length > 0) {
      console.log('  ✓ pickup_flights.updated_at:', flightsCheck.rows[0].data_type);
    } else {
      console.log('  ⚠ pickup_flights.updated_at: 없음');
    }
    
    console.log('\n🎉 마이그레이션이 완료되었습니다!');
    console.log('이제 업체/항공편 수정 시 updated_at이 자동으로 갱신됩니다.\n');
    
  } catch (error) {
    console.error('\n❌ 마이그레이션 실패:', error.message);
    console.error('\n에러 상세:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 실행
addUpdatedAtColumns();
