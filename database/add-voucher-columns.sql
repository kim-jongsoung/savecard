-- 바우처 관련 컬럼 추가
-- 예약 테이블에 바우처 토큰 및 관련 필드 추가

-- 1. 바우처 토큰 (고유 키)
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS voucher_token VARCHAR(100) UNIQUE;

-- 2. QR 코드 데이터
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS qr_code_data TEXT;

-- 3. QR 이미지 경로
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS qr_image_path VARCHAR(255);

-- 4. 수배업체 바우처 파일 경로
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS vendor_voucher_path VARCHAR(255);

-- 5. 바우처 전송 일시
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS voucher_sent_at TIMESTAMP;

-- 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_reservations_voucher_token ON reservations(voucher_token);

-- 코멘트 추가
COMMENT ON COLUMN reservations.voucher_token IS '바우처 고유 토큰 (URL 파라미터)';
COMMENT ON COLUMN reservations.qr_code_data IS 'QR 코드 데이터 (텍스트)';
COMMENT ON COLUMN reservations.qr_image_path IS 'QR 코드 이미지 파일 경로';
COMMENT ON COLUMN reservations.vendor_voucher_path IS '수배업체에서 받은 바우처 파일 경로';
COMMENT ON COLUMN reservations.voucher_sent_at IS '바우처 전송 일시';

-- 확인
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'reservations' 
  AND column_name IN ('voucher_token', 'qr_code_data', 'qr_image_path', 'vendor_voucher_path', 'voucher_sent_at')
ORDER BY column_name;
