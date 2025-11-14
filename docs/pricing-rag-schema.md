# 요금RAG 시스템 - 데이터베이스 스키마 설계

## 📋 목차
1. [시즌 관리](#1-시즌-관리-seasons)
2. [호텔 요금](#2-호텔-요금-hotel_rates)
3. [프로모션 관리](#3-프로모션-관리-promotions)
4. [프로모션 객실 할인](#4-프로모션-객실-할인-promotion_room_discounts)
5. [프로모션 베네핏](#5-프로모션-베네핏-promotion_benefits)
6. [거래처 수배피](#6-거래처-수배피-agency_procurement_fees)
7. [요금 조회 로직](#7-요금-조회-로직)

---

## 1. 시즌 관리 (seasons)

### 테이블 구조
```sql
CREATE TABLE seasons (
  id SERIAL PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  season_name VARCHAR(100) NOT NULL,         -- 시즌명 (예: "극성수기", "크리스마스 특별")
  season_code VARCHAR(50),                    -- 시즌 코드 (예: "PEAK2025", "XMAS")
  start_date DATE NOT NULL,                   -- 시작일
  end_date DATE NOT NULL,                     -- 종료일
  priority INTEGER DEFAULT 0,                 -- 우선순위 (높을수록 우선 적용)
  description TEXT,                           -- 설명
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- 제약조건
  CONSTRAINT valid_season_dates CHECK (end_date >= start_date),
  CONSTRAINT unique_season_code UNIQUE (hotel_id, season_code)
);

CREATE INDEX idx_seasons_hotel_dates ON seasons(hotel_id, start_date, end_date);
CREATE INDEX idx_seasons_active ON seasons(is_active);
```

### 특징
- **중첩 시즌 지원**: 같은 호텔에 날짜가 겹치는 시즌 등록 가능
- **우선순위 관리**: `priority` 값이 높을수록 우선 적용
- **예시**:
  ```
  시즌 A: 2025-11-01 ~ 2025-12-31 (priority: 1)
  시즌 B: 2025-11-15 ~ 2025-11-20 (priority: 2) ← 이 기간엔 시즌 B 적용
  ```

---

## 2. 호텔 요금 (hotel_rates)

### 테이블 구조
```sql
CREATE TABLE hotel_rates (
  id SERIAL PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,  -- NULL이면 기본요금
  rate_type VARCHAR(20) DEFAULT 'base',      -- 'base', 'season', 'promotion'
  rate_per_night DECIMAL(10, 2) NOT NULL,    -- 1박 요금 (USD)
  min_nights INTEGER DEFAULT 1,              -- 최소 숙박일
  max_nights INTEGER,                        -- 최대 숙박일 (NULL이면 무제한)
  effective_date DATE,                       -- 적용 시작일 (시즌이 없을 때)
  expiry_date DATE,                          -- 적용 종료일 (시즌이 없을 때)
  currency VARCHAR(3) DEFAULT 'USD',
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- 제약조건
  CONSTRAINT valid_rate_dates CHECK (expiry_date IS NULL OR expiry_date >= effective_date),
  CONSTRAINT positive_rate CHECK (rate_per_night > 0)
);

CREATE INDEX idx_hotel_rates_lookup ON hotel_rates(hotel_id, room_type_id, season_id, is_active);
CREATE INDEX idx_hotel_rates_dates ON hotel_rates(effective_date, expiry_date);
```

### 요금 타입
- **base**: 기본 요금 (시즌 없음)
- **season**: 시즌별 요금
- **promotion**: 프로모션 요금

### 조회 우선순위
1. 프로모션 요금 (유효한 프로모션 코드 있을 때)
2. 시즌 요금 (해당 날짜에 시즌 있을 때)
3. 기본 요금 (위 두 가지 없을 때)

---

## 3. 프로모션 관리 (promotions)

### 테이블 구조
```sql
CREATE TABLE promotions (
  id SERIAL PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  promo_code VARCHAR(50) NOT NULL,           -- 호텔 부여 프로모션 코드 (필수!)
  promo_name VARCHAR(200) NOT NULL,          -- 프로모션명
  
  -- 예약 생성 가능 기간 (신규 수배 가능 기간)
  booking_start_date DATE NOT NULL,          -- 예약 생성 시작일
  booking_end_date DATE NOT NULL,            -- 예약 생성 종료일
  
  -- 투숙 가능 기간 (실제 체크인 가능 기간)
  stay_start_date DATE NOT NULL,             -- 투숙 시작일
  stay_end_date DATE NOT NULL,               -- 투숙 종료일
  
  discount_type VARCHAR(20) DEFAULT 'amount', -- 'amount' (금액), 'percent' (%)
  min_nights INTEGER DEFAULT 1,              -- 최소 숙박일
  max_nights INTEGER,                        -- 최대 숙박일
  
  description TEXT,                          -- 프로모션 설명
  terms_and_conditions TEXT,                 -- 약관
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- 제약조건
  CONSTRAINT valid_booking_dates CHECK (booking_end_date >= booking_start_date),
  CONSTRAINT valid_stay_dates CHECK (stay_end_date >= stay_start_date),
  CONSTRAINT unique_promo_code UNIQUE (hotel_id, promo_code)
);

CREATE INDEX idx_promotions_code ON promotions(hotel_id, promo_code, is_active);
CREATE INDEX idx_promotions_booking_dates ON promotions(booking_start_date, booking_end_date);
CREATE INDEX idx_promotions_stay_dates ON promotions(stay_start_date, stay_end_date);
```

### 중요 포인트
- **프로모션 코드**: 호텔이 부여한 코드가 시작점
- **이중 날짜 체크**:
  1. 예약 생성일이 `booking_start_date ~ booking_end_date` 안에 있는가?
  2. 체크인일이 `stay_start_date ~ stay_end_date` 안에 있는가?

---

## 4. 프로모션 객실 할인 (promotion_room_discounts)

### 테이블 구조
```sql
CREATE TABLE promotion_room_discounts (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  
  discount_value DECIMAL(10, 2) NOT NULL,    -- 할인 금액 또는 할인율
  discounted_rate DECIMAL(10, 2),            -- 할인 후 1박 요금 (직접 입력 가능)
  
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- 제약조건
  CONSTRAINT unique_promo_room UNIQUE (promotion_id, room_type_id)
);

CREATE INDEX idx_promo_discounts_lookup ON promotion_room_discounts(promotion_id, room_type_id);
```

### 할인 계산 방식
```javascript
// 할인 타입이 'amount'일 때
최종요금 = 기본요금 - discount_value

// 할인 타입이 'percent'일 때
최종요금 = 기본요금 × (1 - discount_value / 100)

// discounted_rate가 직접 입력된 경우
최종요금 = discounted_rate
```

---

## 5. 프로모션 베네핏 (promotion_benefits)

### 테이블 구조
```sql
CREATE TABLE promotion_benefits (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  benefit_type VARCHAR(50) NOT NULL,         -- 'drink_coupon', 'breakfast', 'upgrade', 'credit' 등
  benefit_name VARCHAR(200) NOT NULL,        -- 베네핏명 (예: "웰컴 드링크 2잔")
  benefit_value VARCHAR(200),                -- 값 (예: "2", "$50", "1 Level")
  quantity INTEGER DEFAULT 1,                -- 수량
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_promo_benefits ON promotion_benefits(promotion_id);
```

### 베네핏 타입 예시
- `drink_coupon`: 음료 쿠폰
- `breakfast`: 조식 포함
- `room_upgrade`: 객실 업그레이드
- `resort_credit`: 리조트 크레딧
- `late_checkout`: 레이트 체크아웃
- `early_checkin`: 얼리 체크인
- `spa_voucher`: 스파 이용권

---

## 6. 거래처 수배피 (agency_procurement_fees)

### 테이블 구조
```sql
CREATE TABLE agency_procurement_fees (
  id SERIAL PRIMARY KEY,
  agency_id INTEGER NOT NULL REFERENCES booking_agencies(id) ON DELETE CASCADE,
  hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,  -- NULL이면 전체 호텔 적용
  
  fee_name VARCHAR(100) NOT NULL,            -- 수배피 정책명
  fee_type VARCHAR(20) DEFAULT 'per_night',  -- 'per_night' (1박당), 'flat' (정액제)
  
  -- 1박당 방식
  fee_per_night DECIMAL(10, 2),              -- 1박당 수배피 (USD)
  
  -- 정액제 방식
  max_nights_for_fee INTEGER,                -- 몇 박까지 1박당 계산?
  flat_fee_amount DECIMAL(10, 2),            -- 초과 시 고정 수배피 (USD)
  
  -- 적용 기간
  effective_date DATE,                       -- 적용 시작일
  expiry_date DATE,                          -- 적용 종료일
  
  description TEXT,                          -- 설명
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- 제약조건
  CONSTRAINT valid_fee_dates CHECK (expiry_date IS NULL OR expiry_date >= effective_date)
);

CREATE INDEX idx_agency_fees_lookup ON agency_procurement_fees(agency_id, hotel_id, is_active);
CREATE INDEX idx_agency_fees_dates ON agency_procurement_fees(effective_date, expiry_date);
```

### 수배피 계산 예시

#### 예시 1: 업체 A (1박당 $10 무제한)
```sql
INSERT INTO agency_procurement_fees (
  agency_id, fee_name, fee_type, fee_per_night
) VALUES (
  1, '기본 수배피', 'per_night', 10.00
);
```
- 1박: $10
- 2박: $20
- 3박: $30
- 4박: $40

#### 예시 2: 업체 B (3박까지 1박당 $10, 4박 이상 $30 고정)
```sql
INSERT INTO agency_procurement_fees (
  agency_id, fee_name, fee_type, 
  fee_per_night, max_nights_for_fee, flat_fee_amount
) VALUES (
  2, '3박 이상 정액제', 'flat', 10.00, 3, 30.00
);
```
- 1박: $10
- 2박: $20
- 3박: $30
- 4박: $30 (고정)
- 5박: $30 (고정)

#### 예시 3: 업체 C (시즌별 수배피)
```sql
-- 성수기 수배피
INSERT INTO agency_procurement_fees (
  agency_id, fee_name, fee_type, fee_per_night,
  effective_date, expiry_date
) VALUES (
  3, '성수기 수배피', 'per_night', 15.00,
  '2025-12-15', '2026-01-10'
);

-- 비수기 수배피
INSERT INTO agency_procurement_fees (
  agency_id, fee_name, fee_type, fee_per_night,
  effective_date, expiry_date
) VALUES (
  3, '비수기 수배피', 'per_night', 10.00,
  '2025-01-11', '2025-12-14'
);
```

### 수배피 계산 로직 (JavaScript)
```javascript
function calculateProcurementFee(agencyId, hotelId, nights, checkInDate) {
  // 1. 해당 거래처의 유효한 수배피 정책 조회
  const feePolicy = getFeePolicy(agencyId, hotelId, checkInDate);
  
  if (!feePolicy) return 0;
  
  // 2. 계산 방식에 따라 수배피 계산
  if (feePolicy.fee_type === 'per_night') {
    return feePolicy.fee_per_night * nights;
  } else if (feePolicy.fee_type === 'flat') {
    // 정액제: max_nights_for_fee 이하는 1박당, 초과는 flat_fee_amount
    if (nights <= feePolicy.max_nights_for_fee) {
      return feePolicy.fee_per_night * nights;
    } else {
      return feePolicy.flat_fee_amount;
    }
  }
  
  return 0;
}
```

---

## 7. 요금 조회 로직

### 최종 요금 계산 순서
```
1. 기본 객실 요금 조회
   ↓
2. 해당 날짜에 시즌이 있는가?
   - 있으면: 시즌 요금 적용 (우선순위 높은 시즌)
   - 없으면: 기본 요금 적용
   ↓
3. 유효한 프로모션 코드가 있는가?
   - 예약 생성 기간 체크
   - 투숙 기간 체크
   - 있으면: 프로모션 할인 적용
   ↓
4. 추가 요금 계산
   - 인원 추가 요금
   - 조식 요금
   - 엑스트라 베드
   ↓
5. 거래처 수배피 계산
   - 숙박일 수 기준
   - 해당 날짜 수배피 정책 적용
   ↓
6. 최종 견적서 생성
```

### SQL 쿼리 예시

#### 1) 특정 날짜의 객실 요금 조회 (시즌 고려)
```sql
WITH active_seasons AS (
  SELECT id, priority
  FROM seasons
  WHERE hotel_id = $1
    AND $2 BETWEEN start_date AND end_date
    AND is_active = true
  ORDER BY priority DESC
  LIMIT 1
)
SELECT 
  hr.rate_per_night,
  hr.rate_type,
  s.season_name
FROM hotel_rates hr
LEFT JOIN active_seasons s ON hr.season_id = s.id
WHERE hr.hotel_id = $1
  AND hr.room_type_id = $2
  AND hr.is_active = true
  AND (
    hr.season_id = s.id 
    OR (hr.season_id IS NULL AND hr.rate_type = 'base')
  )
ORDER BY 
  CASE 
    WHEN hr.rate_type = 'season' THEN 1
    WHEN hr.rate_type = 'base' THEN 2
    ELSE 3
  END
LIMIT 1;
```

#### 2) 프로모션 적용 가능 여부 확인
```sql
SELECT 
  p.*,
  prd.discount_value,
  prd.discounted_rate
FROM promotions p
JOIN promotion_room_discounts prd 
  ON p.id = prd.promotion_id
WHERE p.hotel_id = $1
  AND p.promo_code = $2
  AND p.is_active = true
  AND CURRENT_DATE BETWEEN p.booking_start_date AND p.booking_end_date  -- 예약 생성 기간
  AND $3 BETWEEN p.stay_start_date AND p.stay_end_date                  -- 체크인 날짜
  AND prd.room_type_id = $4;
```

#### 3) 거래처 수배피 조회
```sql
SELECT *
FROM agency_procurement_fees
WHERE agency_id = $1
  AND (hotel_id = $2 OR hotel_id IS NULL)
  AND is_active = true
  AND ($3 IS NULL OR $3 BETWEEN effective_date AND COALESCE(expiry_date, '2099-12-31'))
ORDER BY 
  hotel_id DESC NULLS LAST,  -- 특정 호텔 우선
  effective_date DESC         -- 최신 정책 우선
LIMIT 1;
```

---

## 📊 요약

### 테이블 관계도
```
hotels
  ├── seasons (1:N)
  │     └── hotel_rates (1:N)
  ├── room_types (1:N)
  │     ├── hotel_rates (1:N)
  │     └── promotion_room_discounts (1:N)
  └── promotions (1:N)
        ├── promotion_room_discounts (1:N)
        └── promotion_benefits (1:N)

booking_agencies
  └── agency_procurement_fees (1:N)
```

### 핵심 포인트
1. **시즌**: 중첩 가능, 우선순위로 관리
2. **프로모션**: 호텔 코드 기반, 이중 날짜 체크
3. **수배피**: 거래처별 정액/1박당 유연하게 설정

---

## 🚀 다음 단계

### Phase 2-1: 시즌 관리
- [ ] 시즌 CRUD API
- [ ] 시즌 관리 UI
- [ ] 중첩 시즌 검증 로직

### Phase 2-2: 요금 관리
- [ ] 호텔 요금 CRUD API
- [ ] 요금 관리 UI
- [ ] 요금 조회 API (날짜별)

### Phase 2-3: 프로모션 관리
- [ ] 프로모션 CRUD API
- [ ] 프로모션 관리 UI
- [ ] 프로모션 검증 로직

### Phase 2-4: 수배피 관리
- [ ] 수배피 CRUD API
- [ ] 수배피 관리 UI
- [ ] 수배피 계산 로직

### Phase 2-5: 통합 견적 시스템
- [ ] 실시간 요금 조회 API
- [ ] 견적서 생성 기능
- [ ] 예약 시 자동 요금 계산
