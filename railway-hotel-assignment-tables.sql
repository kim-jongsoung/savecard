-- ============================================
-- 호텔 수배서 시스템 테이블 생성
-- Railway PostgreSQL 콘솔에서 직접 실행
-- ============================================

-- 1. hotel_reservations 테이블에 assignment_token 컬럼 추가
ALTER TABLE hotel_reservations
ADD COLUMN IF NOT EXISTS assignment_token VARCHAR(100) UNIQUE;

-- 2. assignment_token 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_assignment_token
ON hotel_reservations(assignment_token);

-- 3. hotel_assignment_history 테이블 생성
CREATE TABLE IF NOT EXISTS hotel_assignment_history (
    id SERIAL PRIMARY KEY,
    reservation_id INTEGER NOT NULL REFERENCES hotel_reservations(id) ON DELETE CASCADE,
    assignment_type VARCHAR(20) NOT NULL CHECK (assignment_type IN ('NEW', 'REVISE', 'CANCEL')),
    revision_number INTEGER DEFAULT 0,
    sent_to_email VARCHAR(255) NOT NULL,
    sent_by VARCHAR(100) NOT NULL,
    sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
    email_message_id VARCHAR(255),
    assignment_link TEXT,
    changes_description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 4. hotel_assignment_history 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_hotel_assignment_history_reservation_id
ON hotel_assignment_history(reservation_id);

CREATE INDEX IF NOT EXISTS idx_hotel_assignment_history_sent_at
ON hotel_assignment_history(sent_at DESC);

-- 5. 확인 쿼리
SELECT 'hotel_assignment_history 테이블 생성 완료' AS status;
SELECT COUNT(*) as record_count FROM hotel_assignment_history;
