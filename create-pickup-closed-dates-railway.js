const { Pool } = require('pg');
require('dotenv').config();

// Railway 프로덕션 데이터베이스에 직접 연결
async function createClosedDatesTableOnRailway() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔧 Railway PostgreSQL에 연결 중...');
    console.log('📍 DATABASE_URL:', process.env.DATABASE_URL ? '설정됨' : '없음');
    
    // 테이블 생성
    console.log('\n1️⃣ pickup_closed_dates 테이블 생성...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pickup_closed_dates (
        id SERIAL PRIMARY KEY,
        closed_date DATE NOT NULL UNIQUE,
        reason TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ 테이블 생성 완료');
    
    // 인덱스 생성
    console.log('\n2️⃣ 인덱스 생성...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_closed_date 
      ON pickup_closed_dates(closed_date)
    `);
    console.log('✅ 인덱스 생성 완료');
    
    // 테이블 확인
    console.log('\n3️⃣ 테이블 구조 확인...');
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'pickup_closed_dates'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📋 테이블 구조:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name.padEnd(15)} | ${row.data_type.padEnd(20)} | Nullable: ${row.is_nullable}`);
    });
    
    // 데이터 확인
    console.log('\n4️⃣ 기존 데이터 확인...');
    const dataCheck = await pool.query('SELECT COUNT(*) as count FROM pickup_closed_dates');
    console.log(`✅ 현재 ${dataCheck.rows[0].count}개의 마감날짜 등록됨`);
    
    console.log('\n✅ Railway 데이터베이스 설정 완료!');
    console.log('🎉 이제 마감날짜 관리 기능을 사용할 수 있습니다.');
    
  } catch (error) {
    console.error('\n❌ 오류 발생:', error.message);
    console.error('\n💡 해결 방법:');
    console.error('1. .env 파일에 DATABASE_URL이 Railway 프로덕션 URL로 설정되어 있는지 확인');
    console.error('2. Railway 대시보드에서 PostgreSQL Variables 확인');
    console.error('3. 또는 Railway 웹 콘솔에서 직접 SQL 실행');
  } finally {
    await pool.end();
  }
}

createClosedDatesTableOnRailway();
