-- 샘플 항공편 데이터 삭제
-- 서버 재시작 시 자동 생성되지 않도록 실서버에서 실행하세요

-- UA200, UA201 샘플 데이터 삭제
DELETE FROM pickup_flights 
WHERE flight_number IN ('UA200', 'UA201')
  AND airline = 'United Airlines';

-- 확인
SELECT * FROM pickup_flights ORDER BY created_at DESC;
