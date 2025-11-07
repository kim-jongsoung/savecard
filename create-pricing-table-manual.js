/**
 * 수동 실행: product_pricing 테이블 생성
 * 사용법: node create-pricing-table-manual.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
});

async function createPricingTables() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 product_pricing 테이블 생성 시작...\n');

    // 1. product_pricing 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_pricing (
        id SERIAL PRIMARY KEY,
        platform_name VARCHAR(100) NOT NULL,
        vendor_id INTEGER REFERENCES vendors(id),
        product_name VARCHAR(255) NOT NULL,
        package_options JSONB NOT NULL DEFAULT '[]',
        notes TEXT,
        is_active BOOLEAN DEFAULT true,
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_platform_product UNIQUE(platform_name, product_name)
      );
    `);
    console.log('✅ product_pricing 테이블 생성 완료');

    // 2. 인덱스 생성
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pricing_platform ON product_pricing(platform_name);
      CREATE INDEX IF NOT EXISTS idx_pricing_product ON product_pricing(product_name);
      CREATE INDEX IF NOT EXISTS idx_pricing_vendor ON product_pricing(vendor_id);
      CREATE INDEX IF NOT EXISTS idx_pricing_active ON product_pricing(is_active);
      CREATE INDEX IF NOT EXISTS idx_pricing_options ON product_pricing USING GIN (package_options);
    `);
    console.log('✅ 인덱스 생성 완료');

    // 3. pricing_history 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_history (
        id SERIAL PRIMARY KEY,
        pricing_id INTEGER REFERENCES product_pricing(id) ON DELETE CASCADE,
        old_package_options JSONB,
        new_package_options JSONB,
        changed_by VARCHAR(100),
        change_reason TEXT,
        version INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ pricing_history 테이블 생성 완료');

    // 4. 샘플 데이터
    await client.query(`
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
         '강 투어 상품')
      ON CONFLICT (platform_name, product_name) DO NOTHING;
    `);
    console.log('✅ 샘플 데이터 삽입 완료');

    console.log('\n🎉 모든 테이블 생성 완료!');
    
  } catch (error) {
    console.error('❌ 오류 발생:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

createPricingTables()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
