const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function addScheduleFields() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 스케줄 관리 필드 추가 시작...');
    
    // 1. 필드 추가 (기존 테이블 확장)
    await client.query(`
      ALTER TABLE airport_pickups 
      ADD COLUMN IF NOT EXISTS pickup_source VARCHAR(20) DEFAULT 'system',
      ADD COLUMN IF NOT EXISTS route_type VARCHAR(200),
      ADD COLUMN IF NOT EXISTS contact_status VARCHAR(50) DEFAULT 'PENDING',
      ADD COLUMN IF NOT EXISTS actual_pickup_time TIME,
      ADD COLUMN IF NOT EXISTS driver_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS driver_vehicle VARCHAR(100),
      ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50),
      ADD COLUMN IF NOT EXISTS special_request TEXT,
      ADD COLUMN IF NOT EXISTS remark TEXT,
      ADD COLUMN IF NOT EXISTS english_name VARCHAR(200),
      ADD COLUMN IF NOT EXISTS parsed_by VARCHAR(20);
    `);
    console.log('✅ 필드 추가 완료');
    
    // 2. 인덱스 추가
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pickup_source ON airport_pickups(pickup_source);
      CREATE INDEX IF NOT EXISTS idx_contact_status ON airport_pickups(contact_status);
      CREATE INDEX IF NOT EXISTS idx_display_date ON airport_pickups(display_date);
    `);
    console.log('✅ 인덱스 추가 완료');
    
    // 3. 기존 데이터 업데이트 (route_type 자동 설정)
    await client.query(`
      UPDATE airport_pickups 
      SET route_type = CASE
        WHEN departure_airport IS NOT NULL AND arrival_airport IS NOT NULL THEN 
          departure_airport || ' → ' || arrival_airport
        WHEN hotel_name IS NOT NULL THEN
          CASE 
            WHEN record_type = 'departure' THEN departure_airport || ' → ' || hotel_name
            WHEN record_type = 'arrival' THEN hotel_name || ' → ' || arrival_airport
            ELSE hotel_name
          END
        ELSE 'Transfer'
      END
      WHERE route_type IS NULL;
    `);
    console.log('✅ 기존 데이터 route_type 설정 완료');
    
    // 4. actual_pickup_time 초기화 (기존 display_time 사용)
    await client.query(`
      UPDATE airport_pickups 
      SET actual_pickup_time = display_time
      WHERE actual_pickup_time IS NULL AND display_time IS NOT NULL;
    `);
    console.log('✅ actual_pickup_time 초기화 완료');
    
    // 5. 현재 데이터 확인
    const countResult = await client.query(`
      SELECT 
        pickup_source,
        record_type,
        COUNT(*) as count
      FROM airport_pickups
      WHERE status = 'active'
      GROUP BY pickup_source, record_type;
    `);
    
    console.log('\n📊 현재 픽업 데이터 현황:');
    if (countResult.rows.length > 0) {
      countResult.rows.forEach(row => {
        console.log(`  ${row.pickup_source || 'system'} - ${row.record_type}: ${row.count}건`);
      });
    } else {
      console.log('  아직 픽업 데이터가 없습니다.');
    }
    
    console.log('\n🎉 스케줄 관리 시스템 준비 완료!');
    console.log('\n📝 추가된 필드:');
    console.log('  ✓ pickup_source: 데이터 출처 (system=자동, manual=수동)');
    console.log('  ✓ route_type: 경로 정보 (예: GUM → Hilton)');
    console.log('  ✓ contact_status: 고객 컨택 상태 (PENDING/CONTACTED)');
    console.log('  ✓ actual_pickup_time: 실제 픽업 시간 (수정 가능)');
    console.log('  ✓ driver_name: 운전수 이름');
    console.log('  ✓ driver_vehicle: 차량 정보');
    console.log('  ✓ payment_status: 결제 상태');
    console.log('  ✓ remark: 비고');
    console.log('  ✓ english_name: 영문 이름');
    console.log('  ✓ parsed_by: AI 파싱 정보');
    
    console.log('\n✅ 기존 예약 시스템과 통합 완료 - 중복 입력 없음!');
    
  } catch (error) {
    console.error('❌ 필드 추가 실패:', error);
    console.error('상세 오류:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

addScheduleFields();
