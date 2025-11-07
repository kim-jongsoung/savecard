/**
 * 마이그레이션 007: 상품 요금 RAG 테이블 생성
 * 
 * 목적: 업체별/상품별 판매가, 수수료율, 원가 관리
 * 특징:
 * - 패키지 옵션별 요금 관리 (JSONB)
 * - 빠른 조회를 위한 인덱스
 * - 버전 관리 (요금 변동 이력)
 */

const { Pool } = require('pg');

async function up(pool) {
  console.log('🔧 마이그레이션 007 시작: product_pricing 테이블 생성...');

  try {
    // 1. product_pricing 테이블 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_pricing (
        id SERIAL PRIMARY KEY,
        
        -- 기본 정보
        platform_name VARCHAR(100) NOT NULL,           -- 예약 업체명 (NOL, KLOOK 등)
        vendor_id INTEGER REFERENCES vendors(id),      -- 수배업체 (NULL 가능)
        product_name VARCHAR(255) NOT NULL,            -- 상품명
        
        -- 패키지 옵션 (JSONB 배열)
        -- [{ option_name: "성인", selling_price: 100, commission_rate: 10, cost_price: 70 }]
        package_options JSONB NOT NULL DEFAULT '[]',
        
        -- 메타 정보
        notes TEXT,                                    -- 비고
        is_active BOOLEAN DEFAULT true,                -- 활성 상태
        version INTEGER DEFAULT 1,                     -- 버전 (가격 변경 시 증가)
        
        -- 타임스탬프
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        -- 유니크 제약 (동일 업체+상품 중복 방지)
        CONSTRAINT unique_platform_product UNIQUE(platform_name, product_name)
      );
    `);
    console.log('✅ product_pricing 테이블 생성 완료');

    // 2. 인덱스 생성 (빠른 검색)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pricing_platform 
      ON product_pricing(platform_name);
      
      CREATE INDEX IF NOT EXISTS idx_pricing_product 
      ON product_pricing(product_name);
      
      CREATE INDEX IF NOT EXISTS idx_pricing_vendor 
      ON product_pricing(vendor_id);
      
      CREATE INDEX IF NOT EXISTS idx_pricing_active 
      ON product_pricing(is_active);
      
      -- JSONB 검색을 위한 GIN 인덱스
      CREATE INDEX IF NOT EXISTS idx_pricing_options 
      ON product_pricing USING GIN (package_options);
    `);
    console.log('✅ 인덱스 생성 완료');

    // 3. 요금 변경 이력 테이블 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_history (
        id SERIAL PRIMARY KEY,
        pricing_id INTEGER REFERENCES product_pricing(id) ON DELETE CASCADE,
        
        -- 변경 전 데이터
        old_package_options JSONB,
        
        -- 변경 후 데이터
        new_package_options JSONB,
        
        -- 변경 정보
        changed_by VARCHAR(100),                       -- 변경자
        change_reason TEXT,                            -- 변경 사유
        version INTEGER,                               -- 버전
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ pricing_history 테이블 생성 완료');

    // 4. 샘플 데이터 삽입 (테스트용)
    await pool.query(`
      INSERT INTO product_pricing (platform_name, product_name, package_options, notes)
      VALUES 
        ('NOL', '괌 돌핀크루즈 투어', 
         '[
           {"option_name": "성인", "selling_price": 120, "commission_rate": 15, "cost_price": 85},
           {"option_name": "아동", "selling_price": 80, "commission_rate": 15, "cost_price": 60},
           {"option_name": "유아", "selling_price": 0, "commission_rate": 0, "cost_price": 0}
         ]'::jsonb,
         '인기 투어 상품'),
        
        ('KLOOK', '괌 정글리버크루즈', 
         '[
           {"option_name": "성인", "selling_price": 95, "commission_rate": 12, "cost_price": 70},
           {"option_name": "아동", "selling_price": 65, "commission_rate": 12, "cost_price": 50}
         ]'::jsonb,
         '강 투어 상품'),
        
        ('투어비스', '괌 스카이다이빙', 
         '[
           {"option_name": "1인", "selling_price": 350, "commission_rate": 10, "cost_price": 300}
         ]'::jsonb,
         '고가 액티비티')
      ON CONFLICT (platform_name, product_name) DO NOTHING;
    `);
    console.log('✅ 샘플 데이터 삽입 완료');

    console.log('🎉 마이그레이션 007 완료!');
    return true;

  } catch (error) {
    console.error('❌ 마이그레이션 007 실패:', error);
    throw error;
  }
}

async function down(pool) {
  console.log('🔧 마이그레이션 007 롤백 시작...');

  try {
    await pool.query('DROP TABLE IF EXISTS pricing_history CASCADE;');
    await pool.query('DROP TABLE IF EXISTS product_pricing CASCADE;');
    console.log('✅ 마이그레이션 007 롤백 완료');
    return true;
  } catch (error) {
    console.error('❌ 롤백 실패:', error);
    throw error;
  }
}

module.exports = { up, down };
