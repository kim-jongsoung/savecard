const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function createPickupTables() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 공항 픽업 테이블 생성 시작...');
    
    // 1. 예약 업체 테이블 (기존 agencies 활용 가능하면 생략)
    await client.query(`
      CREATE TABLE IF NOT EXISTS pickup_agencies (
        id SERIAL PRIMARY KEY,
        agency_name VARCHAR(100) NOT NULL,
        contact_person VARCHAR(100),
        phone VARCHAR(50),
        email VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ pickup_agencies 테이블 생성');
    
    // 2. 픽업 예약 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS airport_pickups (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER REFERENCES pickup_agencies(id),
        
        -- 픽업 유형
        pickup_type VARCHAR(20) NOT NULL, -- 'airport_to_hotel', 'hotel_to_airport', 'roundtrip'
        
        -- 한국 출발 정보 (등록자 입력)
        kr_departure_date DATE,
        kr_departure_time TIME,
        kr_flight_number VARCHAR(20),
        
        -- 괌 도착 정보 (자동 계산)
        guam_arrival_date DATE,
        guam_arrival_time TIME,
        
        -- 괌 출발 정보 (호텔→공항)
        guam_departure_date DATE,
        guam_departure_time TIME,
        departure_flight_number VARCHAR(20),
        
        -- 호텔 픽업 시간 (핵심!)
        hotel_pickup_date DATE,
        hotel_pickup_time TIME,
        
        -- 새벽 비행기 플래그
        is_early_morning BOOLEAN DEFAULT false,
        
        -- 왕복 정보
        return_kr_date DATE,
        return_kr_time TIME,
        return_kr_flight VARCHAR(20),
        return_guam_date DATE,
        return_guam_time TIME,
        return_pickup_date DATE,
        return_pickup_time TIME,
        
        -- 고객 정보
        customer_name VARCHAR(100),
        passenger_count INTEGER,
        hotel_name VARCHAR(200),
        phone VARCHAR(50),
        kakao_id VARCHAR(100),
        memo TEXT,
        
        -- 차량 배정 (기사가 선택)
        vehicle_type VARCHAR(20), -- 'sedan', 'van', 'bus12'
        vehicle_ready BOOLEAN DEFAULT false,
        
        -- 정산 상태
        settlement_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'completed'
        settlement_date DATE,
        
        -- 상태
        status VARCHAR(20) DEFAULT 'active', -- 'active', 'cancelled', 'completed'
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ airport_pickups 테이블 생성');
    
    // 3. 인덱스 생성
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_guam_arrival_date ON airport_pickups(guam_arrival_date);
      CREATE INDEX IF NOT EXISTS idx_hotel_pickup_date ON airport_pickups(hotel_pickup_date);
      CREATE INDEX IF NOT EXISTS idx_status ON airport_pickups(status);
    `);
    console.log('✅ 인덱스 생성 완료');
    
    // 4. 샘플 업체 추가
    await client.query(`
      INSERT INTO pickup_agencies (agency_name, contact_person, phone) 
      VALUES 
        ('투어비스', '김담당', '010-1234-5678'),
        ('NOL', '이담당', '010-2345-6789'),
        ('마이리얼트립', '박담당', '010-3456-7890')
      ON CONFLICT DO NOTHING;
    `);
    console.log('✅ 샘플 업체 추가');
    
    console.log('🎉 공항 픽업 시스템 테이블 생성 완료!');
    
  } catch (error) {
    console.error('❌ 테이블 생성 실패:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

createPickupTables();
