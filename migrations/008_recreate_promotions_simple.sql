-- ==========================================
-- Migration 008: 프로모션 시스템 재설계 (간소화 버전)
-- ==========================================

-- 1. 기존 테이블 삭제 (CASCADE)
DROP TABLE IF EXISTS promotion_room_discounts CASCADE;
DROP TABLE IF EXISTS promotion_benefits CASCADE;
DROP TABLE IF EXISTS promotion_daily_rates CASCADE;
DROP TABLE IF EXISTS promotions CASCADE;

-- 2. 새 promotions 테이블 생성
CREATE TABLE promotions (
  id SERIAL PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  promo_code VARCHAR(50) NOT NULL,
  promo_name VARCHAR(200) NOT NULL,
  booking_start_date DATE NOT NULL,
  booking_end_date DATE NOT NULL,
  stay_start_date DATE NOT NULL,
  stay_end_date DATE NOT NULL,
  description TEXT,
  terms_and_conditions TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_booking_dates CHECK (booking_end_date >= booking_start_date),
  CONSTRAINT valid_stay_dates CHECK (stay_end_date >= stay_start_date),
  CONSTRAINT unique_promo_code UNIQUE (hotel_id, promo_code)
);

-- 3. promotion_daily_rates 테이블 생성
CREATE TABLE promotion_daily_rates (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  stay_date DATE NOT NULL,
  min_nights INTEGER NOT NULL DEFAULT 1,
  max_nights INTEGER,
  rate_per_night DECIMAL(10,2) NOT NULL CHECK (rate_per_night >= 0),
  currency VARCHAR(3) DEFAULT 'USD',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_promo_daily_rate UNIQUE(promotion_id, room_type_id, stay_date, min_nights),
  CONSTRAINT valid_nights_range CHECK (max_nights IS NULL OR max_nights >= min_nights)
);

-- 4. promotion_benefits 테이블 생성
CREATE TABLE promotion_benefits (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  benefit_type VARCHAR(50) NOT NULL,
  benefit_name VARCHAR(200) NOT NULL,
  benefit_value VARCHAR(200),
  quantity INTEGER DEFAULT 1,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. 인덱스 생성
CREATE INDEX idx_promotions_code ON promotions(hotel_id, promo_code, is_active);
CREATE INDEX idx_promotions_booking_dates ON promotions(booking_start_date, booking_end_date);
CREATE INDEX idx_promotions_stay_dates ON promotions(stay_start_date, stay_end_date);
CREATE INDEX idx_promo_daily_rates_lookup ON promotion_daily_rates(promotion_id, room_type_id, stay_date);
CREATE INDEX idx_promo_daily_rates_date ON promotion_daily_rates(stay_date);
CREATE INDEX idx_promo_daily_rates_nights ON promotion_daily_rates(min_nights, max_nights);
CREATE INDEX idx_promo_benefits ON promotion_benefits(promotion_id);

-- 6. updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_promotions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_promo_daily_rates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS promotions_updated_at ON promotions;
CREATE TRIGGER promotions_updated_at
  BEFORE UPDATE ON promotions
  FOR EACH ROW
  EXECUTE FUNCTION update_promotions_updated_at();

DROP TRIGGER IF EXISTS promo_daily_rates_updated_at ON promotion_daily_rates;
CREATE TRIGGER promo_daily_rates_updated_at
  BEFORE UPDATE ON promotion_daily_rates
  FOR EACH ROW
  EXECUTE FUNCTION update_promo_daily_rates_updated_at();
