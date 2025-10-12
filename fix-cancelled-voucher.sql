-- 바우처 토큰으로 예약을 취소 상태로 변경
-- 이 스크립트를 Railway PostgreSQL Data 탭에서 실행하세요

-- 1. 현재 상태 확인
SELECT 
    id,
    reservation_number,
    korean_name,
    payment_status,
    LEFT(voucher_token, 20) || '...' as token_preview,
    updated_at
FROM reservations
WHERE voucher_token = '2ac62be9d3f4e7aece8002f668310a0308581cc7119a6da16cc7337c63e54499';

-- 2. 예약 상태를 취소로 변경
UPDATE reservations 
SET payment_status = 'cancelled',
    updated_at = NOW()
WHERE voucher_token = '2ac62be9d3f4e7aece8002f668310a0308581cc7119a6da16cc7337c63e54499';

-- 3. 변경 후 확인
SELECT 
    id,
    reservation_number,
    korean_name,
    payment_status,
    updated_at
FROM reservations
WHERE voucher_token = '2ac62be9d3f4e7aece8002f668310a0308581cc7119a6da16cc7337c63e54499';

-- 예상 결과:
-- payment_status: 'cancelled'
-- updated_at: 방금 시간

-- ✅ 이제 바우처 링크를 다시 열면 무효화 메시지가 표시됩니다!
