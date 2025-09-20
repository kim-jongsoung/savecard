-- ERP 확장을 위한 데이터베이스 스키마 마이그레이션
-- 실행일: 2025-09-20

-- 1. reservations 테이블에 extras JSONB 컬럼 추가 (없으면 생성)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'reservations' AND column_name = 'extras'
    ) THEN
        ALTER TABLE reservations ADD COLUMN extras JSONB DEFAULT '{}';
        CREATE INDEX IF NOT EXISTS idx_reservations_extras_gin ON reservations USING GIN (extras);
        COMMENT ON COLUMN reservations.extras IS '동적 필드 저장용 JSONB 컬럼';
    END IF;
END $$;

-- 2. field_defs 테이블 생성 (동적 필드 메타데이터 관리)
CREATE TABLE IF NOT EXISTS field_defs (
    id SERIAL PRIMARY KEY,
    field_key VARCHAR(100) NOT NULL UNIQUE,
    field_name VARCHAR(200) NOT NULL,
    field_type VARCHAR(50) NOT NULL DEFAULT 'text', -- text, number, date, select, textarea, checkbox
    field_group VARCHAR(100) DEFAULT 'general',
    validation_rules JSONB DEFAULT '{}',
    ui_config JSONB DEFAULT '{}', -- placeholder, options, min, max 등
    is_required BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE field_defs IS '동적 필드 정의 테이블';
COMMENT ON COLUMN field_defs.field_key IS '필드 키 (extras에서 사용)';
COMMENT ON COLUMN field_defs.field_name IS '필드 표시명';
COMMENT ON COLUMN field_defs.field_type IS '필드 타입 (text, number, date, select 등)';
COMMENT ON COLUMN field_defs.validation_rules IS '검증 규칙 JSON';
COMMENT ON COLUMN field_defs.ui_config IS 'UI 설정 JSON';

-- 3. reservation_audits 테이블 생성 (감사 로그)
CREATE TABLE IF NOT EXISTS reservation_audits (
    id SERIAL PRIMARY KEY,
    reservation_id INTEGER NOT NULL,
    action VARCHAR(50) NOT NULL, -- create, update, delete, status_change
    changed_by VARCHAR(100) NOT NULL,
    changed_at TIMESTAMP DEFAULT NOW(),
    old_values JSONB,
    new_values JSONB,
    diff JSONB, -- 변경된 필드만 저장
    ip_address INET,
    user_agent TEXT,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_reservation_audits_reservation_id ON reservation_audits(reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_audits_changed_at ON reservation_audits(changed_at);
CREATE INDEX IF NOT EXISTS idx_reservation_audits_action ON reservation_audits(action);

COMMENT ON TABLE reservation_audits IS '예약 변경 감사 로그';

-- 4. assignments 테이블 생성 (수배 관리)
CREATE TABLE IF NOT EXISTS assignments (
    id SERIAL PRIMARY KEY,
    reservation_id INTEGER NOT NULL,
    vendor_name VARCHAR(200),
    vendor_contact JSONB, -- phone, email, manager 등
    assignment_type VARCHAR(100) DEFAULT 'general', -- tour, transfer, activity 등
    status VARCHAR(50) DEFAULT 'requested', -- requested, assigned, in_progress, completed, cancelled
    cost_price DECIMAL(10,2),
    cost_currency VARCHAR(3) DEFAULT 'USD',
    voucher_number VARCHAR(100),
    voucher_url TEXT,
    voucher_issued_at TIMESTAMP,
    notes TEXT,
    assigned_by VARCHAR(100),
    assigned_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_reservation_id ON assignments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);
CREATE INDEX IF NOT EXISTS idx_assignments_vendor_name ON assignments(vendor_name);

COMMENT ON TABLE assignments IS '수배 관리 테이블';

-- 5. purchase_lines 테이블 생성 (매입 라인)
CREATE TABLE IF NOT EXISTS purchase_lines (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER NOT NULL,
    reservation_id INTEGER NOT NULL,
    item_name VARCHAR(300) NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    vendor_name VARCHAR(200),
    purchase_date DATE,
    invoice_number VARCHAR(100),
    payment_status VARCHAR(50) DEFAULT 'pending', -- pending, paid, overdue
    payment_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_lines_assignment_id ON purchase_lines(assignment_id);
CREATE INDEX IF NOT EXISTS idx_purchase_lines_reservation_id ON purchase_lines(reservation_id);
CREATE INDEX IF NOT EXISTS idx_purchase_lines_payment_status ON purchase_lines(payment_status);

COMMENT ON TABLE purchase_lines IS '매입 라인 테이블';

-- 6. sales_lines 테이블 생성 (매출 라인)
CREATE TABLE IF NOT EXISTS sales_lines (
    id SERIAL PRIMARY KEY,
    reservation_id INTEGER NOT NULL,
    item_name VARCHAR(300) NOT NULL,
    quantity INTEGER DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    sale_date DATE,
    invoice_number VARCHAR(100),
    payment_status VARCHAR(50) DEFAULT 'pending', -- pending, received, overdue
    payment_date DATE,
    commission_rate DECIMAL(5,2) DEFAULT 0.00,
    commission_amount DECIMAL(10,2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_lines_reservation_id ON sales_lines(reservation_id);
CREATE INDEX IF NOT EXISTS idx_sales_lines_payment_status ON sales_lines(payment_status);

COMMENT ON TABLE sales_lines IS '매출 라인 테이블';

-- 7. settlements 테이블 생성 (정산 관리)
CREATE TABLE IF NOT EXISTS settlements (
    id SERIAL PRIMARY KEY,
    settlement_period VARCHAR(20) NOT NULL, -- YYYY-MM 형식
    reservation_id INTEGER,
    total_sales DECIMAL(12,2) DEFAULT 0.00,
    total_purchases DECIMAL(12,2) DEFAULT 0.00,
    gross_margin DECIMAL(12,2) DEFAULT 0.00,
    margin_rate DECIMAL(5,2) DEFAULT 0.00,
    currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(50) DEFAULT 'draft', -- draft, confirmed, paid
    settlement_date DATE,
    payment_date DATE,
    notes TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlements_settlement_period ON settlements(settlement_period);
CREATE INDEX IF NOT EXISTS idx_settlements_reservation_id ON settlements(reservation_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);

COMMENT ON TABLE settlements IS '정산 관리 테이블';

-- 8. notification_outbox 테이블 개선 (없으면 생성)
CREATE TABLE IF NOT EXISTS notification_outbox (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    recipient_type VARCHAR(50) NOT NULL, -- email, sms, kakao
    recipient VARCHAR(300) NOT NULL,
    subject VARCHAR(500),
    content TEXT NOT NULL,
    template_name VARCHAR(100),
    template_data JSONB,
    status VARCHAR(50) DEFAULT 'pending', -- pending, sent, failed, retry
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    scheduled_at TIMESTAMP DEFAULT NOW(),
    sent_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status ON notification_outbox(status);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_scheduled_at ON notification_outbox(scheduled_at);

-- 9. 기본 field_defs 데이터 삽입
INSERT INTO field_defs (field_key, field_name, field_type, field_group, validation_rules, ui_config, is_required, sort_order)
VALUES 
    ('special_requests', '특별 요청사항', 'textarea', 'booking', '{"maxLength": 1000}', '{"placeholder": "특별한 요청사항이 있으시면 입력해주세요", "rows": 3}', false, 10),
    ('dietary_restrictions', '식이 제한사항', 'text', 'traveler', '{"maxLength": 200}', '{"placeholder": "알레르기, 채식주의 등"}', false, 20),
    ('emergency_contact', '비상 연락처', 'text', 'traveler', '{"pattern": "^[0-9+\\-\\s()]+$"}', '{"placeholder": "+82-10-1234-5678"}', false, 30),
    ('tour_guide_language', '가이드 언어', 'select', 'service', '{}', '{"options": ["한국어", "영어", "일본어", "중국어"]}', false, 40),
    ('pickup_location_detail', '픽업 위치 상세', 'text', 'service', '{"maxLength": 300}', '{"placeholder": "호텔 로비, 특정 위치 등"}', false, 50),
    ('internal_notes', '내부 메모', 'textarea', 'internal', '{"maxLength": 2000}', '{"placeholder": "내부 직원용 메모", "rows": 4}', false, 100)
ON CONFLICT (field_key) DO NOTHING;

-- 10. 기존 reservations 테이블에 새로운 상태 추가를 위한 체크 제약조건 업데이트
DO $$
BEGIN
    -- 기존 체크 제약조건 삭제 (있다면)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'reservations' AND constraint_name LIKE '%status_check%'
    ) THEN
        ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
    END IF;
    
    -- 새로운 체크 제약조건 추가
    ALTER TABLE reservations ADD CONSTRAINT reservations_status_check 
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'in_progress', 'needs_review'));
END $$;

-- 마이그레이션 완료 로그
INSERT INTO migration_log (version, description, executed_at) 
VALUES ('002', 'ERP 확장: extras JSONB, field_defs, audits, assignments, purchase/sales lines, settlements', NOW())
ON CONFLICT (version) DO NOTHING;

COMMENT ON DATABASE current_database() IS 'Updated with ERP expansion features - 2025-09-20';
