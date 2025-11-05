-- 요금 RAG 문서 테이블 생성
CREATE TABLE IF NOT EXISTS price_rag_documents (
    id SERIAL PRIMARY KEY,
    product_name VARCHAR(255) NOT NULL,
    package_name VARCHAR(255),
    supplier_name VARCHAR(255),
    
    -- 판매가 (매출)
    sale_currency VARCHAR(10) DEFAULT 'KRW',
    sale_adult_price DECIMAL(10, 2) DEFAULT 0,
    sale_child_price DECIMAL(10, 2) DEFAULT 0,
    sale_infant_price DECIMAL(10, 2) DEFAULT 0,
    commission_rate DECIMAL(5, 2) DEFAULT 0,
    
    -- 원가 (매입)
    cost_currency VARCHAR(10) DEFAULT 'USD',
    cost_adult_price DECIMAL(10, 2) DEFAULT 0,
    cost_child_price DECIMAL(10, 2) DEFAULT 0,
    cost_infant_price DECIMAL(10, 2) DEFAULT 0,
    
    -- 메타데이터
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100) DEFAULT 'admin'
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_price_rag_product_name ON price_rag_documents(product_name);
CREATE INDEX IF NOT EXISTS idx_price_rag_supplier_name ON price_rag_documents(supplier_name);
CREATE INDEX IF NOT EXISTS idx_price_rag_created_at ON price_rag_documents(created_at DESC);

-- 코멘트 추가
COMMENT ON TABLE price_rag_documents IS '정산이관 시 AI가 참조하는 상품별 요금 정보';
COMMENT ON COLUMN price_rag_documents.product_name IS '상품명 (필수)';
COMMENT ON COLUMN price_rag_documents.package_name IS '패키지명 (선택)';
COMMENT ON COLUMN price_rag_documents.commission_rate IS '수수료율 (%)';
