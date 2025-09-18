-- 예약 중요사항/메모 테이블 생성
CREATE TABLE IF NOT EXISTS reservation_memos (
    id SERIAL PRIMARY KEY,
    reservation_id INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
    
    -- 항공편 정보
    departure_flight VARCHAR(20),           -- 출국 항공편 (예: LJ0913)
    departure_date DATE,                    -- 괌 도착날짜
    departure_time TIME,                    -- 괌 도착시간
    
    return_flight VARCHAR(20),              -- 귀국 항공편 (예: LJ0920)
    return_date DATE,                       -- 괌 출발날짜
    return_time TIME,                       -- 괌 출발시간
    
    -- 추가 짐/장비 정보
    golf_bags INTEGER DEFAULT 0,           -- 골프백 수량
    strollers INTEGER DEFAULT 0,           -- 유모차 수량
    luggage_count INTEGER DEFAULT 0,       -- 캐리어/짐 수량
    luggage_notes TEXT,                    -- 짐 관련 추가 메모
    
    -- 픽업/교통 관련
    pickup_location VARCHAR(200),          -- 픽업 장소
    pickup_time TIME,                      -- 픽업 시간
    pickup_notes TEXT,                     -- 픽업 관련 메모
    
    -- 중요사항 전체 텍스트
    important_notes TEXT,                  -- 중요사항 원문
    additional_memo TEXT,                  -- 추가 메모
    
    -- 메타데이터
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_reservation_memos_reservation_id ON reservation_memos(reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_memos_departure_date ON reservation_memos(departure_date);
CREATE INDEX IF NOT EXISTS idx_reservation_memos_return_date ON reservation_memos(return_date);
