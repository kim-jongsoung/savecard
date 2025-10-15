-- 투어비스 업체 확인
SELECT * FROM pickup_agencies WHERE agency_name = '투어비스';

-- 투어비스와 연결된 픽업건 확인 (모든 상태)
SELECT 
  ap.id,
  ap.customer_name,
  ap.flight_number,
  ap.status,
  ap.record_type,
  ap.display_date,
  pa.agency_name
FROM airport_pickups ap
LEFT JOIN pickup_agencies pa ON ap.agency_id = pa.id
WHERE pa.agency_name = '투어비스'
ORDER BY ap.display_date DESC;

-- 투어비스 픽업건 상태별 카운트
SELECT 
  ap.status,
  COUNT(*) as count
FROM airport_pickups ap
LEFT JOIN pickup_agencies pa ON ap.agency_id = pa.id
WHERE pa.agency_name = '투어비스'
GROUP BY ap.status;

-- 모든 업체별 픽업건 카운트
SELECT 
  COALESCE(pa.agency_name, '(업체 없음)') as agency_name,
  ap.status,
  COUNT(*) as count
FROM airport_pickups ap
LEFT JOIN pickup_agencies pa ON ap.agency_id = pa.id
GROUP BY pa.agency_name, ap.status
ORDER BY pa.agency_name, ap.status;
