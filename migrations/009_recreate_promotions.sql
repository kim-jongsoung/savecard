-- ==========================================
-- Migration 008: 프로모션 시스템 재설계
-- ==========================================
-- 
-- 목적:
-- - 날짜별 + 연박별 요금 관리
-- - 실제 예약 시스템과 연동
-- - 프로모션이 모든 예약의 기준
--
-- 변경사항:
-- 1. 기존 promotions 테이블 백업 및 재생성
-- 2. promotion_daily_rates 테이블 생성 (핵심)
-- 3. promotion_benefits 테이블 유지
-- ==========================================

-- 1. 기존 테이블 백업
DO $$
BEGIN
  -- promotions 백업 (데이터가 있다면)
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'promotions') THEN
    CREATE TABLE IF NOT EXISTS promotions_backup AS SELECT * FROM promotions;
    RAISE NOTICE '✓ promotions 테이블 백업 완료';
  END IF;
  
  -- promotion_room_discounts 백업 (데이터가 있다면)
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'promotion_room_discounts') THEN
    CREATE TABLE IF NOT EXISTS promotion_room_discounts_backup AS SELECT * FROM promotion_room_discounts;
    RAISE NOTICE '✓ promotion_room_discounts 테이블 백업 완료';
  END IF;
END $$;

-- 2. 기존 테이블 삭제 (CASCADE)
DROP TABLE IF EXISTS promotion_room_discounts CASCADE;
DROP TABLE IF EXISTS promotion_benefits CASCADE;
DROP TABLE IF EXISTS promotions CASCADE;

-- 3. 새 promotions 테이블 생성
CREATE TABLE promotions (
  id SERIAL PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  
  -- 프로모션 기본 정보
  promo_code VARCHAR(50) NOT NULL,
  promo_name VARCHAR(200) NOT NULL,
  
  -- 예약 가능 기간 (이 기간 내에만 신규 예약 가능)
  booking_start_date DATE NOT NULL,
  booking_end_date DATE NOT NULL,
  
  -- 투숙 가능 기간 (전체 범위, 실제 요금은 daily_rates에서 관리)
  stay_start_date DATE NOT NULL,
  stay_end_date DATE NOT NULL,
  
  -- 부가 정보
  description TEXT,
  terms_and_conditions TEXT,
  
  -- 상태
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- 제약 조건
  CONSTRAINT valid_booking_dates CHECK (booking_end_date >= booking_start_date),
  CONSTRAINT valid_stay_dates CHECK (stay_end_date >= stay_start_date),
  CONSTRAINT unique_promo_code UNIQUE (hotel_id, promo_code)
);

-- 4. promotion_daily_rates 테이블 생성 ⭐ 핵심!
CREATE TABLE promotion_daily_rates (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  
  -- 투숙일 (특정 날짜)
  stay_date DATE NOT NULL,
  
  -- 연박 조건
  min_nights INTEGER NOT NULL DEFAULT 1,  -- 최소 X박 이상일 때 이 요금 적용
  max_nights INTEGER,                      -- 최대 X박까지 (NULL이면 무제한)
  
  -- 1박 요금
  rate_per_night DECIMAL(10,2) NOT NULL CHECK (rate_per_night >= 0),
  currency VARCHAR(3) DEFAULT 'USD',
  
  -- 메모
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- 제약 조건: 같은 프로모션/객실/날짜/연박조건은 하나만
  CONSTRAINT unique_promo_daily_rate 
    UNIQUE(promotion_id, room_type_id, stay_date, min_nights),
  
  -- 연박 조건 유효성 체크
  CONSTRAINT valid_nights_range 
    CHECK (max_nights IS NULL OR max_nights >= min_nights)
);

-- 5. promotion_benefits 테이블 재생성
CREATE TABLE promotion_benefits (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  
  -- 베네핏 정보
  benefit_type VARCHAR(50) NOT NULL,
  benefit_name VARCHAR(200) NOT NULL,
  benefit_value VARCHAR(200),
  quantity INTEGER DEFAULT 1,
  description TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. 인덱스 생성
CREATE INDEX idx_promotions_code ON promotions(hotel_id, promo_code, is_active);
CREATE INDEX idx_promotions_booking_dates ON promotions(booking_start_date, booking_end_date);
CREATE INDEX idx_promotions_stay_dates ON promotions(stay_start_date, stay_end_date);

CREATE INDEX idx_promo_daily_rates_lookup ON promotion_daily_rates(promotion_id, room_type_id, stay_date);
CREATE INDEX idx_promo_daily_rates_date ON promotion_daily_rates(stay_date);
CREATE INDEX idx_promo_daily_rates_nights ON promotion_daily_rates(min_nights, max_nights);

CREATE INDEX idx_promo_benefits ON promotion_benefits(promotion_id);

-- 7. updated_at 자동 업데이트 트리거
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

-- 8. 완료 메시지
DO $$
BEGIN
  RAISE NOTICE '✅ 프로모션 시스템 재설계 완료!';
  RAISE NOTICE '';
  RAISE NOTICE '생성된 테이블:';
  RAISE NOTICE '  1. promotions - 프로모션 기본 정보';
  RAISE NOTICE '  2. promotion_daily_rates - 날짜별 + 연박별 요금';
  RAISE NOTICE '  3. promotion_benefits - 베네핏';
  RAISE NOTICE '';
  RAISE NOTICE '백업된 테이블:';
  RAISE NOTICE '  - promotions_backup';
  RAISE NOTICE '  - promotion_room_discounts_backup';
END $$;
