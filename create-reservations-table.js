const { Pool } = require('pg');

// Railway PostgreSQL 연결 설정
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createReservationsTable() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 reservations 테이블 생성 시작...');
    
    // 예약 데이터 테이블 생성
    await client.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        company VARCHAR(50) DEFAULT 'NOL',
        reservation_number VARCHAR(50),
        confirmation_number VARCHAR(50),
        booking_channel VARCHAR(100),
        product_name VARCHAR(200),
        amount DECIMAL(10,2),
        package_type VARCHAR(100),
        usage_date DATE,
        usage_time TIME,
        korean_name VARCHAR(100),
        english_name VARCHAR(100),
        email VARCHAR(150),
        phone VARCHAR(20),
        kakao_id VARCHAR(100),
        guest_count INTEGER,
        memo TEXT,
        issue_code_id INTEGER REFERENCES issue_codes(id),
        code_issued BOOLEAN DEFAULT FALSE,
        code_issued_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ reservations 테이블 생성 완료');
    
    // 테이블 존재 확인
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'reservations'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ reservations 테이블 존재 확인됨');
    } else {
      console.log('❌ reservations 테이블이 존재하지 않음');
    }
    
    // 컬럼 정보 확인
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'reservations'
      ORDER BY ordinal_position
    `);
    
    console.log('📋 reservations 테이블 컬럼 정보:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
  } catch (error) {
    console.error('❌ 테이블 생성 오류:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

createReservationsTable();
