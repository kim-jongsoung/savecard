-- 공항픽업 마감날짜 테이블 생성 SQL
-- Railway PostgreSQL 콘솔에서 직접 실행하세요

-- 1. 테이블 생성
CREATE TABLE IF NOT EXISTS pickup_closed_dates (
  id SERIAL PRIMARY KEY,
  closed_date DATE NOT NULL UNIQUE,
  reason TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_closed_date 
ON pickup_closed_dates(closed_date);

-- 3. 코멘트 추가
COMMENT ON TABLE pickup_closed_dates IS '공항픽업 마감날짜 관리';
COMMENT ON COLUMN pickup_closed_dates.closed_date IS '마감 처리할 날짜';
COMMENT ON COLUMN pickup_closed_dates.reason IS '마감 사유 (예: 차량 부족, 연휴 등)';
COMMENT ON COLUMN pickup_closed_dates.created_by IS '등록한 관리자 ID';

-- 4. 테이블 확인
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'pickup_closed_dates'
ORDER BY ordinal_position;

-- 5. 샘플 데이터 (선택사항 - 테스트용)
-- INSERT INTO pickup_closed_dates (closed_date, reason, created_by) 
-- VALUES ('2025-12-25', '크리스마스 연휴', 'admin');
