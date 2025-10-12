-- 바우처 전송 기록 테이블
CREATE TABLE IF NOT EXISTS voucher_sends (
    id SERIAL PRIMARY KEY,
    reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    voucher_token VARCHAR(100) NOT NULL,
    
    -- 전송 정보
    send_method VARCHAR(20) NOT NULL, -- 'email', 'kakao', 'sms', 'link'
    recipient VARCHAR(255), -- 이메일 주소 또는 전화번호
    subject VARCHAR(255), -- 이메일 제목
    message TEXT, -- 추가 메시지
    
    -- 상태 추적
    status VARCHAR(20) DEFAULT 'sent', -- 'sent', 'delivered', 'failed', 'bounced'
    sent_at TIMESTAMP DEFAULT NOW(),
    delivered_at TIMESTAMP, -- 수신 확인
    viewed_at TIMESTAMP, -- 열람 확인 (링크 클릭)
    
    -- 메타데이터
    sent_by VARCHAR(100), -- 발송자 (관리자 이름)
    ip_address VARCHAR(50), -- 열람 IP
    user_agent TEXT, -- 열람 기기 정보
    error_message TEXT, -- 실패 시 오류 메시지
    
    -- 인덱스 및 타임스탬프
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_voucher_sends_reservation ON voucher_sends(reservation_id);
CREATE INDEX IF NOT EXISTS idx_voucher_sends_token ON voucher_sends(voucher_token);
CREATE INDEX IF NOT EXISTS idx_voucher_sends_status ON voucher_sends(status);
CREATE INDEX IF NOT EXISTS idx_voucher_sends_sent_at ON voucher_sends(sent_at DESC);

-- 바우처 열람 로그 테이블 (상세 추적)
CREATE TABLE IF NOT EXISTS voucher_views (
    id SERIAL PRIMARY KEY,
    voucher_token VARCHAR(100) NOT NULL,
    reservation_id INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
    
    -- 열람 정보
    viewed_at TIMESTAMP DEFAULT NOW(),
    ip_address VARCHAR(50),
    user_agent TEXT,
    device_type VARCHAR(20), -- 'mobile', 'desktop', 'tablet'
    browser VARCHAR(50),
    os VARCHAR(50),
    
    -- 위치 정보 (선택)
    country VARCHAR(50),
    city VARCHAR(100),
    
    -- 행동 추적
    time_spent INTEGER, -- 체류 시간 (초)
    scrolled_to_bottom BOOLEAN DEFAULT FALSE, -- 끝까지 스크롤 여부
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_voucher_views_token ON voucher_views(voucher_token);
CREATE INDEX IF NOT EXISTS idx_voucher_views_reservation ON voucher_views(reservation_id);
CREATE INDEX IF NOT EXISTS idx_voucher_views_viewed_at ON voucher_views(viewed_at DESC);

-- 통계용 뷰 생성
CREATE OR REPLACE VIEW voucher_stats AS
SELECT 
    DATE(sent_at) as send_date,
    send_method,
    COUNT(*) as total_sends,
    COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful_sends,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_sends,
    COUNT(CASE WHEN viewed_at IS NOT NULL THEN 1 END) as viewed_count,
    ROUND(
        COUNT(CASE WHEN viewed_at IS NOT NULL THEN 1 END)::NUMERIC / 
        NULLIF(COUNT(*), 0) * 100, 2
    ) as view_rate,
    AVG(EXTRACT(EPOCH FROM (viewed_at - sent_at))/3600) as avg_hours_to_view
FROM voucher_sends
WHERE sent_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(sent_at), send_method
ORDER BY send_date DESC, send_method;

-- 예약별 바우처 상태 뷰
CREATE OR REPLACE VIEW reservation_voucher_status AS
SELECT 
    r.id as reservation_id,
    r.reservation_number,
    r.korean_name,
    r.product_name,
    r.usage_date,
    r.voucher_token,
    COUNT(vs.id) as send_count,
    MAX(vs.sent_at) as last_sent_at,
    MAX(vs.viewed_at) as last_viewed_at,
    CASE 
        WHEN MAX(vs.viewed_at) IS NOT NULL THEN 'viewed'
        WHEN MAX(vs.sent_at) IS NOT NULL THEN 'sent'
        ELSE 'not_sent'
    END as voucher_status
FROM reservations r
LEFT JOIN voucher_sends vs ON r.id = vs.reservation_id
WHERE r.payment_status IN ('confirmed', 'voucher_sent')
GROUP BY r.id, r.reservation_number, r.korean_name, r.product_name, r.usage_date, r.voucher_token;

-- 트리거: 바우처 열람 시 voucher_sends 업데이트
CREATE OR REPLACE FUNCTION update_voucher_viewed()
RETURNS TRIGGER AS $$
BEGIN
    -- 첫 열람인 경우 voucher_sends에 viewed_at 업데이트
    UPDATE voucher_sends
    SET viewed_at = NEW.viewed_at,
        ip_address = NEW.ip_address,
        user_agent = NEW.user_agent,
        updated_at = NOW()
    WHERE voucher_token = NEW.voucher_token
      AND viewed_at IS NULL;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_voucher_viewed
AFTER INSERT ON voucher_views
FOR EACH ROW
EXECUTE FUNCTION update_voucher_viewed();

-- 샘플 데이터 (테스트용)
-- INSERT INTO voucher_sends (reservation_id, voucher_token, send_method, recipient, sent_by, status)
-- VALUES (1, 'sample-token-123', 'email', 'customer@example.com', 'admin', 'sent');

COMMENT ON TABLE voucher_sends IS '바우처 전송 기록 (이메일, SMS, 카카오톡 등)';
COMMENT ON TABLE voucher_views IS '바우처 열람 로그 (고객이 링크를 클릭한 기록)';
COMMENT ON VIEW voucher_stats IS '바우처 전송/열람 통계 (최근 30일)';
COMMENT ON VIEW reservation_voucher_status IS '예약별 바우처 상태 요약';
