-- 요금 RAG 테이블 생성

CREATE TABLE IF NOT EXISTS pricing_rates (
    id SERIAL PRIMARY KEY,
    platform_name VARCHAR(100) NOT NULL,        -- 예약업체명
    vendor_name VARCHAR(100),                   -- 수배업체명
    product_name VARCHAR(255) NOT NULL,         -- 상품명
    package_name VARCHAR(255) NOT NULL,         -- 패키지 옵션명
    sale_price DECIMAL(10,2) NOT NULL,          -- 판매가
    commission_rate DECIMAL(5,2) DEFAULT 0,     -- 수수료율 (%)
    cost_price DECIMAL(10,2) NOT NULL,          -- 원가
    currency VARCHAR(10) DEFAULT 'USD',         -- 통화
    is_active BOOLEAN DEFAULT true,             -- 활성 여부
    notes TEXT,                                 -- 메모
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(50),                     -- 등록자
    updated_by VARCHAR(50)                      -- 수정자
);

-- 인덱스 생성 (빠른 조회를 위해)
CREATE INDEX idx_pricing_platform_product ON pricing_rates(platform_name, product_name);
CREATE INDEX idx_pricing_vendor ON pricing_rates(vendor_name);
CREATE INDEX idx_pricing_active ON pricing_rates(is_active);

-- 업데이트 시각 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_pricing_rates_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_pricing_rates_timestamp
    BEFORE UPDATE ON pricing_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_pricing_rates_timestamp();

COMMENT ON TABLE pricing_rates IS '요금 정보 RAG 테이블';
COMMENT ON COLUMN pricing_rates.platform_name IS '예약업체명 (판매처)';
COMMENT ON COLUMN pricing_rates.vendor_name IS '수배업체명 (공급처)';
COMMENT ON COLUMN pricing_rates.product_name IS '상품명';
COMMENT ON COLUMN pricing_rates.package_name IS '패키지/옵션명';
COMMENT ON COLUMN pricing_rates.sale_price IS '판매가';
COMMENT ON COLUMN pricing_rates.commission_rate IS '수수료율 (%)';
COMMENT ON COLUMN pricing_rates.cost_price IS '원가 (매입가)';
