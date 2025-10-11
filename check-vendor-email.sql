-- 수배업체 이메일 확인 쿼리
-- 이 쿼리를 실행하여 등록된 수배업체와 이메일을 확인하세요

-- 1. 모든 수배업체 정보 조회
SELECT 
    id,
    vendor_name,
    email,
    phone,
    is_active
FROM vendors
ORDER BY vendor_name;

-- 2. 이메일이 없는 수배업체 찾기
SELECT 
    id,
    vendor_name,
    email,
    phone
FROM vendors
WHERE email IS NULL OR email = ''
ORDER BY vendor_name;

-- 3. 수배서와 연결된 수배업체 확인
SELECT 
    a.id as assignment_id,
    r.reservation_number,
    r.product_name,
    a.vendor_id,
    a.vendor_name,
    v.email as vendor_email,
    v.phone as vendor_phone
FROM assignments a
JOIN reservations r ON a.reservation_id = r.id
LEFT JOIN vendors v ON a.vendor_id = v.id
ORDER BY a.assigned_at DESC
LIMIT 10;

-- 4. 특정 수배업체의 이메일 업데이트 (예시)
-- UPDATE vendors SET email = 'vendor@example.com' WHERE id = 1;
