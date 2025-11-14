-- 시즌 관리 시스템 테이블 생성

-- 1. 시즌 타입 테이블 (5가지 시즌 고정)
CREATE TABLE IF NOT EXISTS season_types (
  id SERIAL PRIMARY KEY,
  season_code VARCHAR(20) UNIQUE NOT NULL,
  season_name VARCHAR(100) NOT NULL,
  season_name_en VARCHAR(100),
  display_order INTEGER NOT NULL,
  color_code VARCHAR(20), -- UI 표시용 색상 (#FF5733 등)
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 호텔별 시즌 달력 테이블 (날짜별 시즌 매핑)
CREATE TABLE IF NOT EXISTS season_calendar (
  id SERIAL PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  season_type_id INTEGER NOT NULL REFERENCES season_types(id) ON DELETE CASCADE,
  calendar_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hotel_id, calendar_date)
);

-- 3. 시즌별 객실 기본 요금 테이블
CREATE TABLE IF NOT EXISTS season_rates (
  id SERIAL PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  season_type_id INTEGER NOT NULL REFERENCES season_types(id) ON DELETE CASCADE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  base_rate DECIMAL(10,2) NOT NULL, -- 기본 요금
  currency VARCHAR(10) DEFAULT 'USD',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hotel_id, season_type_id, room_type_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_season_calendar_hotel_date ON season_calendar(hotel_id, calendar_date);
CREATE INDEX IF NOT EXISTS idx_season_calendar_date ON season_calendar(calendar_date);
CREATE INDEX IF NOT EXISTS idx_season_rates_hotel_season ON season_rates(hotel_id, season_type_id);

-- 5가지 시즌 기본 데이터 삽입
INSERT INTO season_types (season_code, season_name, season_name_en, display_order, color_code, description) VALUES
('LOW', '비수기 (로우시즌)', 'Low Season', 1, '#90EE90', '비수기 - 가장 저렴한 시즌'),
('SHOULDER', '평수기 (숄더시즌)', 'Shoulder Season', 2, '#87CEEB', '평수기 - 보통 가격'),
('HIGH', '성수기 (하이시즌)', 'High Season', 3, '#FFD700', '성수기 - 비싼 시즌'),
('PEAK', '극성수기 (피크시즌)', 'Peak Season', 4, '#FF6347', '극성수기 - 가장 비싼 시즌'),
('UNASSIGNED', '시즌미정', 'Unassigned', 5, '#D3D3D3', '아무 시즌도 아님')
ON CONFLICT (season_code) DO NOTHING;

-- updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_season_calendar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_season_rates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS season_calendar_updated_at ON season_calendar;
CREATE TRIGGER season_calendar_updated_at
  BEFORE UPDATE ON season_calendar
  FOR EACH ROW
  EXECUTE FUNCTION update_season_calendar_updated_at();

DROP TRIGGER IF EXISTS season_rates_updated_at ON season_rates;
CREATE TRIGGER season_rates_updated_at
  BEFORE UPDATE ON season_rates
  FOR EACH ROW
  EXECUTE FUNCTION update_season_rates_updated_at();
