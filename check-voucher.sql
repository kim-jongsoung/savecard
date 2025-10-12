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
    a.vendor_name
FROM reservations r
LEFT JOIN assignments a ON r.id = a.reservation_id
WHERE r.voucher_token = '35fff9765f28c322493f96ad4b43f56830b9cdc5e41499f4deafabcaa8aa8e92';

-- 최근 생성된 바우처 토큰들 (최근 10개)
SELECT 
    id,
    reservation_number,
    korean_name,
    voucher_token,
    payment_status,
    updated_at
FROM reservations
WHERE voucher_token IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;

-- 바우처 토큰이 NULL인 confirmed 예약들
SELECT 
    id,
    reservation_number,
    korean_name,
    payment_status,
    voucher_token
FROM reservations
WHERE payment_status = 'confirmed'
  AND voucher_token IS NULL
ORDER BY updated_at DESC
LIMIT 10;
