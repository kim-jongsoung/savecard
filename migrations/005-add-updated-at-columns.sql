-- pickup_agencies 테이블에 updated_at 컬럼 추가
ALTER TABLE pickup_agencies 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- pickup_flights 테이블에 updated_at 컬럼 추가
ALTER TABLE pickup_flights 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 기존 데이터의 updated_at을 created_at과 동일하게 설정
UPDATE pickup_agencies 
SET updated_at = created_at 
WHERE updated_at IS NULL;

UPDATE pickup_flights 
SET updated_at = created_at 
WHERE updated_at IS NULL;

COMMENT ON COLUMN pickup_agencies.updated_at IS '업체 정보 최종 수정일시';
COMMENT ON COLUMN pickup_flights.updated_at IS '항공편 정보 최종 수정일시';
