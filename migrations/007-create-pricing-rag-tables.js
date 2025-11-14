/**
 * Migration 007: 요금RAG 시스템 테이블 생성
 * 
 * 생성 테이블:
 * 1. seasons - 시즌 관리 (중첩 시즌 지원)
 * 2. hotel_rates - 호텔 객실 요금
 * 3. promotions - 프로모션 관리
 * 4. promotion_room_discounts - 프로모션 객실별 할인
 * 5. promotion_benefits - 프로모션 베네핏
 * 6. agency_procurement_fees - 거래처별 수배피
 */

require('dotenv').config({ path: './railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway.app') ? { rejectUnauthorized: false } : false
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Migration 007: 요금RAG 시스템 테이블 생성 시작...\n');
    
    await client.query('BEGIN');
    
    // ==========================================
    // 1. seasons 테이블 생성
    // ==========================================
    console.log('📅 1/6: seasons 테이블 생성 중...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS seasons (
        id SERIAL PRIMARY KEY,
        hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        season_name VARCHAR(100) NOT NULL,
        season_code VARCHAR(50),
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        priority INTEGER DEFAULT 0,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        CONSTRAINT valid_season_dates CHECK (end_date >= start_date),
        CONSTRAINT unique_season_code UNIQUE (hotel_id, season_code)
      )
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_seasons_hotel_dates 
      ON seasons(hotel_id, start_date, end_date)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_seasons_active 
      ON seasons(is_active)
    `);
    
    console.log('✅ seasons 테이블 생성 완료\n');
    
    // ==========================================
    // 2. hotel_rates 테이블 생성
    // ==========================================
    console.log('💰 2/6: hotel_rates 테이블 생성 중...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS hotel_rates (
        id SERIAL PRIMARY KEY,
        hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
        season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
        rate_type VARCHAR(20) DEFAULT 'base',
        rate_per_night DECIMAL(10, 2) NOT NULL,
        min_nights INTEGER DEFAULT 1,
        max_nights INTEGER,
        effective_date DATE,
        expiry_date DATE,
        currency VARCHAR(3) DEFAULT 'USD',
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        CONSTRAINT valid_rate_dates CHECK (expiry_date IS NULL OR expiry_date >= effective_date),
        CONSTRAINT positive_rate CHECK (rate_per_night > 0)
      )
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hotel_rates_lookup 
      ON hotel_rates(hotel_id, room_type_id, season_id, is_active)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hotel_rates_dates 
      ON hotel_rates(effective_date, expiry_date)
    `);
    
    console.log('✅ hotel_rates 테이블 생성 완료\n');
    
    // ==========================================
    // 3. promotions 테이블 생성
    // ==========================================
    console.log('🎁 3/6: promotions 테이블 생성 중...');
    
    // 기존 테이블이 있다면 삭제 (CASCADE)
    await client.query(`DROP TABLE IF EXISTS promotion_benefits CASCADE`);
    await client.query(`DROP TABLE IF EXISTS promotion_room_discounts CASCADE`);
    await client.query(`DROP TABLE IF EXISTS promotions CASCADE`);
    
    await client.query(`
      CREATE TABLE promotions (
        id SERIAL PRIMARY KEY,
        hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        promo_code VARCHAR(50) NOT NULL,
        promo_name VARCHAR(200) NOT NULL,
        
        booking_start_date DATE NOT NULL,
        booking_end_date DATE NOT NULL,
        
        stay_start_date DATE NOT NULL,
        stay_end_date DATE NOT NULL,
        
        discount_type VARCHAR(20) DEFAULT 'amount',
        min_nights INTEGER DEFAULT 1,
        max_nights INTEGER,
        
        description TEXT,
        terms_and_conditions TEXT,
        
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        CONSTRAINT valid_booking_dates CHECK (booking_end_date >= booking_start_date),
        CONSTRAINT valid_stay_dates CHECK (stay_end_date >= stay_start_date),
        CONSTRAINT unique_promo_code UNIQUE (hotel_id, promo_code)
      )
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_promotions_code 
      ON promotions(hotel_id, promo_code, is_active)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_promotions_booking_dates 
      ON promotions(booking_start_date, booking_end_date)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_promotions_stay_dates 
      ON promotions(stay_start_date, stay_end_date)
    `);
    
    console.log('✅ promotions 테이블 생성 완료\n');
    
    // ==========================================
    // 4. promotion_room_discounts 테이블 생성
    // ==========================================
    console.log('🔖 4/6: promotion_room_discounts 테이블 생성 중...');
    await client.query(`
      CREATE TABLE promotion_room_discounts (
        id SERIAL PRIMARY KEY,
        promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
        room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
        
        discount_value DECIMAL(10, 2) NOT NULL,
        discounted_rate DECIMAL(10, 2),
        
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        
        CONSTRAINT unique_promo_room UNIQUE (promotion_id, room_type_id)
      )
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_promo_discounts_lookup 
      ON promotion_room_discounts(promotion_id, room_type_id)
    `);
    
    console.log('✅ promotion_room_discounts 테이블 생성 완료\n');
    
    // ==========================================
    // 5. promotion_benefits 테이블 생성
    // ==========================================
    console.log('🎉 5/6: promotion_benefits 테이블 생성 중...');
    await client.query(`
      CREATE TABLE promotion_benefits (
        id SERIAL PRIMARY KEY,
        promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
        benefit_type VARCHAR(50) NOT NULL,
        benefit_name VARCHAR(200) NOT NULL,
        benefit_value VARCHAR(200),
        quantity INTEGER DEFAULT 1,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_promo_benefits 
      ON promotion_benefits(promotion_id)
    `);
    
    console.log('✅ promotion_benefits 테이블 생성 완료\n');
    
    // ==========================================
    // 6. agency_procurement_fees 테이블 생성
    // ==========================================
    console.log('💵 6/6: agency_procurement_fees 테이블 생성 중...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS agency_procurement_fees (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER NOT NULL REFERENCES booking_agencies(id) ON DELETE CASCADE,
        hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
        
        fee_name VARCHAR(100) NOT NULL,
        fee_type VARCHAR(20) DEFAULT 'per_night',
        
        fee_per_night DECIMAL(10, 2),
        
        max_nights_for_fee INTEGER,
        flat_fee_amount DECIMAL(10, 2),
        
        effective_date DATE,
        expiry_date DATE,
        
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        CONSTRAINT valid_fee_dates CHECK (expiry_date IS NULL OR expiry_date >= effective_date)
      )
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_fees_lookup 
      ON agency_procurement_fees(agency_id, hotel_id, is_active)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_fees_dates 
      ON agency_procurement_fees(effective_date, expiry_date)
    `);
    
    console.log('✅ agency_procurement_fees 테이블 생성 완료\n');
    
    await client.query('COMMIT');
    
    console.log('✨ Migration 007 완료!\n');
    console.log('생성된 테이블:');
    console.log('  1. seasons (시즌 관리)');
    console.log('  2. hotel_rates (호텔 요금)');
    console.log('  3. promotions (프로모션)');
    console.log('  4. promotion_room_discounts (프로모션 객실 할인)');
    console.log('  5. promotion_benefits (프로모션 베네핏)');
    console.log('  6. agency_procurement_fees (거래처 수배피)');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration 실패:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// 실행
if (require.main === module) {
  migrate()
    .then(() => {
      console.log('\n🎊 마이그레이션이 성공적으로 완료되었습니다!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 마이그레이션 중 오류 발생:', error.message);
      process.exit(1);
    });
}

module.exports = { migrate };
