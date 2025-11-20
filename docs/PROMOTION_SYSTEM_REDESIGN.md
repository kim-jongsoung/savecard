# 🔄 프로모션 시스템 재설계 제안

## 📌 현재 문제점

### 1. **잘못된 데이터 구조**
```
현재: promotion_daily_rates 테이블
- promotion_id
- room_type_id  ← 문제: 프로모션마다 룸타입 매핑 필요
- stay_date
- rate_per_night
```

**문제 발생 시나리오:**
```
예) Hilton - Deluxe Ocean View 룸타입
├── 일반가 (기본 요금)
├── 프로모션 A (할인가)
├── 프로모션 B (특가)
└── 프로모션 C (얼리버드)
```
→ **프로모션이 생길 때마다 room_types에 새로운 룸타입을 추가해야 함**
→ **동일한 룸타입이 여러 개 존재하게 됨**

### 2. **운영상 문제점**
- ❌ 프로모션 추가/삭제 시마다 룸타입 테이블 수정 필요
- ❌ 동일 룸에 대한 중복 데이터 관리
- ❌ 인박스 자동 매칭 시 혼란
- ❌ 예약 시 프로모션 선택 불가능 (자동 매칭만 가능)

---

## ✅ 새로운 구조 제안

### **핵심 개념 변경**
```
기존: 프로모션 = 룸타입 + 요금
변경: 룸타입 (고정) + 프로모션 (선택) = 최종 요금
```

### **1. 룸타입 마스터 (기존 유지)**
```sql
room_types (변경 없음)
- id
- hotel_id
- room_type_code (예: "DELUXE_OCEAN")
- room_type_name (예: "Deluxe Ocean View")
- standard_occupancy
- max_occupancy
```

### **2. 기본 요금 테이블 (신규)**
```sql
CREATE TABLE base_room_rates (
  id SERIAL PRIMARY KEY,
  room_type_id INTEGER REFERENCES room_types(id),
  stay_date DATE NOT NULL,
  base_rate DECIMAL(10,2) NOT NULL,  -- 기본 판매가
  cost_rate DECIMAL(10,2),           -- 원가
  currency VARCHAR(3) DEFAULT 'USD',
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(room_type_id, stay_date)
);
```

### **3. 프로모션 테이블 (재설계)**
```sql
CREATE TABLE promotions (
  id SERIAL PRIMARY KEY,
  hotel_id INTEGER REFERENCES hotels(id),
  promo_code VARCHAR(50) NOT NULL,
  promo_name VARCHAR(200) NOT NULL,
  
  -- 적용 기간
  booking_start_date DATE NOT NULL,    -- 예약 가능 시작일
  booking_end_date DATE NOT NULL,      -- 예약 가능 종료일
  stay_start_date DATE NOT NULL,       -- 투숙 가능 시작일
  stay_end_date DATE NOT NULL,         -- 투숙 가능 종료일
  
  -- 할인 설정
  discount_type VARCHAR(20) NOT NULL,  -- 'PERCENTAGE', 'FIXED_AMOUNT'
  discount_value DECIMAL(10,2),        -- 할인율(%) 또는 할인액($)
  
  -- 적용 조건
  min_nights INTEGER DEFAULT 1,        -- 최소 숙박일
  max_nights INTEGER,                  -- 최대 숙박일
  applicable_room_types INTEGER[],     -- 적용 가능한 룸타입 IDs (배열)
  
  -- 메타 정보
  description TEXT,
  terms_and_conditions TEXT,
  priority INTEGER DEFAULT 0,          -- 우선순위 (높을수록 우선)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(hotel_id, promo_code)
);
```

### **4. 프로모션 특전 테이블 (기존 유지, 개선)**
```sql
CREATE TABLE promotion_benefits (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER REFERENCES promotions(id) ON DELETE CASCADE,
  benefit_type VARCHAR(50) NOT NULL,   -- 'BREAKFAST', 'UPGRADE', 'CREDIT', 'AMENITY'
  benefit_name VARCHAR(200) NOT NULL,
  benefit_value VARCHAR(200),
  quantity INTEGER DEFAULT 1,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔄 워크플로우 변경

### **기존 방식 (문제)**
```
1. 프로모션 생성 → 룸타입 추가 필요
2. 인박스 파싱 → 자동으로 룸타입 매칭
3. 예약 저장 (프로모션 선택 불가)
```

### **새로운 방식 (개선)**
```
1. 프로모션 생성 → 할인율/할인액 + 적용 룸타입 지정
2. 인박스 파싱 → 룸타입만 매칭
3. 예약 시:
   ├── 선택한 룸타입의 기본 요금 조회
   ├── 적용 가능한 프로모션 목록 제시
   │   ├── 예약일 체크 (booking_start_date ~ booking_end_date)
   │   ├── 투숙일 체크 (stay_start_date ~ stay_end_date)
   │   ├── 숙박일 체크 (min_nights, max_nights)
   │   └── 룸타입 체크 (applicable_room_types)
   └── 프로모션 선택 → 최종 금액 계산
```

---

## 💰 요금 계산 로직

### **프로모션 미적용**
```javascript
최종 금액 = 기본 요금 × 숙박일
```

### **프로모션 적용**
```javascript
// 1. 퍼센트 할인
if (promotion.discount_type === 'PERCENTAGE') {
  할인 금액 = 기본 요금 × (할인율 / 100)
  최종 금액 = (기본 요금 - 할인 금액) × 숙박일
}

// 2. 정액 할인
if (promotion.discount_type === 'FIXED_AMOUNT') {
  최종 금액 = (기본 요금 - 할인액) × 숙박일
}
```

### **예시**
```
룸타입: Deluxe Ocean View
기본 요금: $200/박
숙박일: 3박

[프로모션 미적용]
= $200 × 3 = $600

[프로모션 A: 20% 할인]
= ($200 - $40) × 3 = $160 × 3 = $480

[프로모션 B: $50 할인]
= ($200 - $50) × 3 = $150 × 3 = $450
```

---

## 📊 UI 변경사항

### **1. 프로모션 등록 페이지**
```
기존:
├── 1단계: 기본 정보
├── 2단계: 룸타입별 일자별 요금 입력 (복잡!)
└── 3단계: 특전 설정

변경:
├── 1단계: 기본 정보
│   ├── 프로모션 코드/이름
│   ├── 예약 기간
│   ├── 투숙 기간
│   └── 최소/최대 숙박일
├── 2단계: 할인 설정
│   ├── 할인 타입 (퍼센트 / 정액)
│   ├── 할인값 입력
│   └── 적용 룸타입 선택 (체크박스)
└── 3단계: 특전 설정
    ├── 조식 포함 여부
    ├── 룸 업그레이드
    └── 기타 어메니티
```

### **2. 인박스 예약 페이지**
```
기존:
└── 룸타입 자동 매칭 → 저장

변경:
├── 룸타입 선택 (또는 자동 매칭)
├── 프로모션 선택 (드롭다운)
│   ├── [선택 안 함] - 기본 요금
│   ├── [SUMMER20] 20% 할인 - $480 (원래 $600)
│   └── [EARLYBIRD] $50 할인 - $450 (원래 $600)
└── 저장
```

---

## 🚀 마이그레이션 계획

### **Phase 1: 데이터베이스 재설계 (1-2시간)**
```sql
-- 1. 기존 promotion_daily_rates 백업
CREATE TABLE promotion_daily_rates_backup AS 
SELECT * FROM promotion_daily_rates;

-- 2. 새 테이블 생성
CREATE TABLE base_room_rates (...);

-- 3. promotions 테이블 재구성
ALTER TABLE promotions 
  ADD COLUMN discount_type VARCHAR(20),
  ADD COLUMN discount_value DECIMAL(10,2),
  ADD COLUMN min_nights INTEGER DEFAULT 1,
  ADD COLUMN max_nights INTEGER,
  ADD COLUMN applicable_room_types INTEGER[],
  ADD COLUMN priority INTEGER DEFAULT 0;

-- 4. promotion_daily_rates 삭제
DROP TABLE promotion_daily_rates;
```

### **Phase 2: API 수정 (2-3시간)**
```
- POST /api/promotions (프로모션 등록)
- GET /api/promotions/:hotelId/applicable (적용 가능한 프로모션 조회)
- POST /api/base-rates (기본 요금 등록)
- GET /api/base-rates/:roomTypeId/:date (기본 요금 조회)
```

### **Phase 3: UI 수정 (2-3시간)**
```
- views/admin/promotions.ejs (프로모션 등록 간소화)
- views/admin/inbox.ejs (프로모션 선택 기능 추가)
```

### **Phase 4: 테스트 & 배포 (1시간)**
```
- 프로모션 등록 테스트
- 예약 시 프로모션 적용 테스트
- 요금 계산 정확도 확인
```

---

## ✅ 장점

1. **데이터 정규화**: 룸타입과 프로모션 분리
2. **유연한 운영**: 프로모션 추가/삭제가 자유로움
3. **사용자 경험 개선**: 예약 시 프로모션 선택 가능
4. **자동화 가능**: 기간/조건에 맞는 프로모션 자동 제안
5. **확장성**: 다양한 할인 타입 추가 가능

---

## 🎯 다음 단계

1. **승인 요청**: 위 설계안 검토
2. **마이그레이션 실행**: 데이터베이스 재설계
3. **API 개발**: 프로모션 적용 로직 구현
4. **UI 수정**: 프로모션 선택 인터페이스 추가
5. **테스트**: 전체 워크플로우 검증

---

**작성일**: 2025-01-20  
**작성자**: Cascade AI
