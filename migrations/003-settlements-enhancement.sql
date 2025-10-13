-- 정산관리 고도화 마이그레이션
-- 작성일: 2025-10-12
-- 목적: 다통화, 환율, RAG 통합 지원

-- 1. 기존 settlements 테이블 확장
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS platform_id INTEGER;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS usage_date DATE;

-- 플랫폼 정산 (원화 기준)
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS gross_amount_krw DECIMAL(15,2) DEFAULT 0.00;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS commission_percent DECIMAL(5,2);
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS commission_flat_krw DECIMAL(15,2);
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS commission_amount_krw DECIMAL(15,2) DEFAULT 0.00;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS net_from_platform_krw DECIMAL(15,2) DEFAULT 0.00;

-- 공급사 원가 (현지통화 + 원화)
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS supplier_cost_currency VARCHAR(3) DEFAULT 'USD';
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS supplier_cost_amount DECIMAL(15,2) DEFAULT 0.00;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS fx_rate DECIMAL(10,4);
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS fx_rate_date DATE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS supplier_cost_krw DECIMAL(15,2) DEFAULT 0.00;

-- 마진
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS margin_krw DECIMAL(15,2) DEFAULT 0.00;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS margin_rate DECIMAL(5,2);

-- RAG 문서 참조
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS rag_document_ids TEXT[]; -- 사용된 RAG 문서 ID 배열
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS rag_evidence JSONB; -- 근거 정보 (문서명, 페이지, 발췌문 등)

-- 입출금 관리
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS payment_received BOOLEAN DEFAULT FALSE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS payment_received_at TIMESTAMP;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS payment_received_amount DECIMAL(15,2);
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS payment_received_note TEXT;

ALTER TABLE settlements ADD COLUMN IF NOT EXISTS payment_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS payment_sent_at TIMESTAMP;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS payment_sent_amount DECIMAL(15,2);
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS payment_sent_currency VARCHAR(3);
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS payment_sent_note TEXT;

-- 정산 상태 확장
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS auto_migrated BOOLEAN DEFAULT FALSE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMP;

-- 2. 환율 테이블 생성
CREATE TABLE IF NOT EXISTS exchange_rates (
    id SERIAL PRIMARY KEY,
    currency_code VARCHAR(3) NOT NULL,
    rate_date DATE NOT NULL,
    rate_time TIME DEFAULT '16:00:00',
    base_currency VARCHAR(3) DEFAULT 'KRW',
    rate DECIMAL(10,4) NOT NULL,
    source VARCHAR(50) DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(currency_code, rate_date, rate_time)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency_date ON exchange_rates(currency_code, rate_date DESC);

COMMENT ON TABLE exchange_rates IS '환율 테이블 (KRW 기준)';
COMMENT ON COLUMN exchange_rates.rate IS 'KRW 1원당 외화 금액 (예: USD 0.00075 = 1,333원)';

-- 3. RAG 문서 메타데이터 확장
CREATE TABLE IF NOT EXISTS rag_documents (
    id SERIAL PRIMARY KEY,
    document_name VARCHAR(255) NOT NULL,
    document_type VARCHAR(50) NOT NULL, -- 'contract', 'cost_sheet', 'commission_policy', 'fx_policy'
    platform_id INTEGER,
    supplier_id INTEGER,
    effective_from DATE,
    effective_to DATE,
    file_path TEXT,
    content_text TEXT,
    vector_embedding TEXT, -- 벡터 임베딩 (JSON 또는 바이너리)
    metadata JSONB,
    uploaded_by VARCHAR(100),
    uploaded_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_documents_type ON rag_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_rag_documents_platform ON rag_documents(platform_id);
CREATE INDEX IF NOT EXISTS idx_rag_documents_supplier ON rag_documents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_rag_documents_effective ON rag_documents(effective_from, effective_to);

COMMENT ON TABLE rag_documents IS 'RAG 문서 메타데이터 (계약서, 원가표, 수수료 정책 등)';

-- 4. 정산 배치 로그 테이블
CREATE TABLE IF NOT EXISTS settlement_batch_logs (
    id SERIAL PRIMARY KEY,
    batch_date DATE NOT NULL,
    batch_type VARCHAR(50) NOT NULL, -- 'auto_migration', 'bulk_settlement', 'payment_import'
    total_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    error_details JSONB,
    executed_by VARCHAR(100),
    executed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_batch_logs_date ON settlement_batch_logs(batch_date DESC);

COMMENT ON TABLE settlement_batch_logs IS '정산 배치 작업 로그';

-- 5. 기존 데이터 마이그레이션 (safe update)
-- 기존 total_sales -> gross_amount_krw
UPDATE settlements 
SET gross_amount_krw = total_sales
WHERE gross_amount_krw = 0 AND total_sales > 0;

-- 기존 total_purchases -> supplier_cost_krw
UPDATE settlements 
SET supplier_cost_krw = total_purchases
WHERE supplier_cost_krw = 0 AND total_purchases > 0;

-- 기존 gross_margin -> margin_krw
UPDATE settlements 
SET margin_krw = gross_margin
WHERE margin_krw = 0 AND gross_margin != 0;

-- 완료 메시지
DO $$ 
BEGIN 
    RAISE NOTICE '✅ 정산관리 테이블 확장 완료';
    RAISE NOTICE '   - settlements 테이블: 다통화, 환율, RAG 참조 추가';
    RAISE NOTICE '   - exchange_rates 테이블: 환율 관리';
    RAISE NOTICE '   - rag_documents 테이블: RAG 문서 메타데이터';
    RAISE NOTICE '   - settlement_batch_logs 테이블: 배치 작업 로그';
END $$;
