-- 픽업 항공편 관리 테이블
CREATE TABLE IF NOT EXISTS pickup_flights (
  id SERIAL PRIMARY KEY,
  flight_number VARCHAR(50) NOT NULL,
  airline VARCHAR(100),
  departure_time TIME NOT NULL,
  arrival_time TIME NOT NULL,
  flight_hours DECIMAL(4,2),
  departure_airport VARCHAR(10) NOT NULL,
  arrival_airport VARCHAR(10) NOT NULL,
  days_of_week VARCHAR(50) DEFAULT '1,2,3,4,5,6,7',
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(flight_number)
);

-- 픽업 업체 관리 테이블
CREATE TABLE IF NOT EXISTS pickup_agencies (
  id SERIAL PRIMARY KEY,
  agency_name VARCHAR(200) NOT NULL,
  contact_person VARCHAR(100),
  phone VARCHAR(50),
  email VARCHAR(200),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_pickup_flights_active ON pickup_flights(is_active);
CREATE INDEX IF NOT EXISTS idx_pickup_flights_departure ON pickup_flights(departure_airport);
CREATE INDEX IF NOT EXISTS idx_pickup_flights_arrival ON pickup_flights(arrival_airport);
CREATE INDEX IF NOT EXISTS idx_pickup_agencies_active ON pickup_agencies(is_active);
CREATE INDEX IF NOT EXISTS idx_pickup_agencies_name ON pickup_agencies(agency_name);

COMMENT ON TABLE pickup_flights IS '픽업 서비스 항공편 관리';
COMMENT ON TABLE pickup_agencies IS '픽업 서비스 업체 관리';

-- 샘플 데이터는 제거됨 (자동 생성 방지)
