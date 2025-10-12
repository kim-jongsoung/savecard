-- 특정 바우처 토큰 확인
SELECT 
    r.id,
    r.reservation_number,
    r.korean_name,
    r.product_name,
    r.voucher_token,
    r.payment_status,
    r.qr_code_data,
    r.qr_image_path,
    r.vendor_voucher_path,
    a.confirmation_number,
    a.vendor_name,
    a.vendor_contact,
    LENGTH(r.voucher_token) as token_length
FROM reservations r
LEFT JOIN assignments a ON r.id = a.reservation_id
WHERE r.voucher_token = '2ac62be9d3f4e7aece8002f668310a0308581cc7119a6da16cc7337c63e54499';

-- 토큰 길이 비교 (정상 토큰들)
SELECT 
    id,
    reservation_number,
    korean_name,
    LEFT(voucher_token, 20) || '...' as token_preview,
    LENGTH(voucher_token) as token_length,
    payment_status
FROM reservations
WHERE voucher_token IS NOT NULL
ORDER BY id DESC
LIMIT 10;

-- 토큰으로 바로 검색 (대소문자 구분 없이)
SELECT 
    id,
    reservation_number,
    korean_name,
    voucher_token
FROM reservations
WHERE LOWER(voucher_token) = LOWER('2ac62be9d3f4e7aece8002f668310a0308581cc7119a6da16cc7337c63e54499');
