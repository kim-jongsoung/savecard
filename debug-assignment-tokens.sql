-- 1. assignments 테이블의 assignment_token 확인 (예약건마다 다른가?)
SELECT 
    id,
    reservation_id,
    LEFT(assignment_token, 20) as token_prefix,
    assignment_token,
    vendor_name,
    created_at
FROM assignments
ORDER BY created_at DESC
LIMIT 10;

-- 2. assignment_views 테이블의 assignment_token 분포 확인
SELECT 
    LEFT(assignment_token, 20) as token_prefix,
    COUNT(*) as view_count
FROM assignment_views
GROUP BY assignment_token
ORDER BY view_count DESC
LIMIT 10;

-- 3. assignment_token이 NULL인 레코드 개수
SELECT 
    COUNT(*) as null_token_count,
    (SELECT COUNT(*) FROM assignment_views) as total_count
FROM assignment_views
WHERE assignment_token IS NULL;

-- 4. 특정 예약 ID의 assignment_token 확인
SELECT 
    a.id,
    a.reservation_id,
    a.assignment_token,
    COUNT(av.id) as view_count
FROM assignments a
LEFT JOIN assignment_views av ON av.assignment_token = a.assignment_token
WHERE a.reservation_id IN (114, 115, 116, 117)
GROUP BY a.id, a.reservation_id, a.assignment_token
ORDER BY a.reservation_id;
