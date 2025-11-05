-- 정산관리 테이블 생성
CREATE TABLE IF NOT EXISTS settlements (
    id SERIAL PRIMARY KEY,
    reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    
    -- 매출 정보 (받을 돈)
    sale_currency VARCHAR(10) DEFAULT 'KRW',
    sale_adult_price DECIMAL(10, 2) DEFAULT 0,
    sale_child_price DECIMAL(10, 2) DEFAULT 0,
    sale_infant_price DECIMAL(10, 2) DEFAULT 0,
    total_sale DECIMAL(10, 2) DEFAULT 0,
    commission_rate DECIMAL(5, 2) DEFAULT 0,
    commission_amount DECIMAL(10, 2) DEFAULT 0,
    net_revenue DECIMAL(10, 2) DEFAULT 0,
    
    -- 매입 정보 (줄 돈)
    cost_currency VARCHAR(10) DEFAULT 'USD',
    cost_adult_price DECIMAL(10, 2) DEFAULT 0,
    cost_child_price DECIMAL(10, 2) DEFAULT 0,
    cost_infant_price DECIMAL(10, 2) DEFAULT 0,
    total_cost DECIMAL(10, 2) DEFAULT 0,
    
    -- 환율 및 마진
    exchange_rate DECIMAL(10, 4) DEFAULT 1330,
    cost_krw DECIMAL(10, 2) DEFAULT 0,
    margin_krw DECIMAL(10, 2) DEFAULT 0,
    margin_rate DECIMAL(5, 2) DEFAULT 0,
    
    -- 입금/송금 처리
    payment_received_date DATE,
    payment_sent_date DATE,
    settlement_status VARCHAR(50) DEFAULT 'pending',
    
    -- 메타데이터
    memo TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100) DEFAULT 'admin',
    
    UNIQUE(reservation_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_settlements_reservation_id ON settlements(reservation_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(settlement_status);
CREATE INDEX IF NOT EXISTS idx_settlements_payment_received ON settlements(payment_received_date);
CREATE INDEX IF NOT EXISTS idx_settlements_payment_sent ON settlements(payment_sent_date);
CREATE INDEX IF NOT EXISTS idx_settlements_created_at ON settlements(created_at DESC);

-- 코멘트 추가
COMMENT ON TABLE settlements IS '정산 관리 테이블 - 매출/매입/입금/송금 관리';
COMMENT ON COLUMN settlements.settlement_status IS '정산 상태 (pending: 미완료, payment_received: 입금완료, payment_sent: 송금완료, completed: 전체완료)';
COMMENT ON COLUMN settlements.net_revenue IS '입금받을금액 (판매가 - 수수료)';
COMMENT ON COLUMN settlements.cost_krw IS '매입 원화환산 금액';
COMMENT ON COLUMN settlements.margin_krw IS '예상 마진 (원화 기준)';
