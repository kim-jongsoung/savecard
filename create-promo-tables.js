/**
 * 프로모션 테이블 생성 스크립트
 * 
 * 사용 방법:
 * 1. Railway에서 DATABASE_URL 복사
 * 2. 아래 databaseUrl 변수에 붙여넣기
 * 3. node create-promo-tables.js 실행
 */

const { Pool } = require('pg');

// ⬇️⬇️⬇️ 여기에 Railway DATABASE_URL 붙여넣으세요 ⬇️⬇️⬇️
const databaseUrl = 'postgresql://postgres:UWGlOaPdwvynoOILFdKfbNyJjmPPjgcg@metro.proxy.rlwy.net:25887/railway';
// ⬆️⬆️⬆️ 여기에 Railway DATABASE_URL 붙여넣으세요 ⬆️⬆️⬆️

async function createTables() {
  console.log('🔧 프로모션 테이블 생성 시작...\n');
  
  if (!databaseUrl || databaseUrl === 'postgres://...') {
    console.error('❌ DATABASE_URL을 설정하세요!');
    console.log('\n1. Railway 대시보드 → Postgres → Connect 탭');
    console.log('2. DATABASE_URL 복사');
    console.log('3. 이 파일의 databaseUrl 변수에 붙여넣기');
    console.log('4. node create-promo-tables.js 실행\n');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('📡 데이터베이스 연결 중...');
    await pool.query('SELECT 1');
    console.log('✅ 연결 성공!\n');

    console.log('🗑️  기존 테이블 삭제...');
    await pool.query(`
      DROP TABLE IF EXISTS promotion_room_discounts CASCADE;
      DROP TABLE IF EXISTS promotion_benefits CASCADE;
      DROP TABLE IF EXISTS promotion_daily_rates CASCADE;
      DROP TABLE IF EXISTS promotions CASCADE;
    `);
    console.log('✅ 삭제 완료\n');

    console.log('📋 promotions 테이블 생성...');
    await pool.query(`
      CREATE TABLE promotions (
        id SERIAL PRIMARY KEY,
        hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
        promo_code VARCHAR(50) NOT NULL,
        promo_name VARCHAR(200) NOT NULL,
        booking_start_date DATE NOT NULL,
        booking_end_date DATE NOT NULL,
        stay_start_date DATE NOT NULL,
        stay_end_date DATE NOT NULL,
        description TEXT,
        terms_and_conditions TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT valid_booking_dates CHECK (booking_end_date >= booking_start_date),
        CONSTRAINT valid_stay_dates CHECK (stay_end_date >= stay_start_date),
        CONSTRAINT unique_promo_code UNIQUE (hotel_id, promo_code)
      );
    `);
    console.log('✅ promotions 생성 완료');

    console.log('📋 promotion_daily_rates 테이블 생성...');
    await pool.query(`
      CREATE TABLE promotion_daily_rates (
        id SERIAL PRIMARY KEY,
        promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
        room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
        stay_date DATE NOT NULL,
        min_nights INTEGER NOT NULL DEFAULT 1,
        max_nights INTEGER,
        rate_per_night DECIMAL(10,2) NOT NULL CHECK (rate_per_night >= 0),
        currency VARCHAR(3) DEFAULT 'USD',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_promo_daily_rate UNIQUE(promotion_id, room_type_id, stay_date, min_nights),
        CONSTRAINT valid_nights_range CHECK (max_nights IS NULL OR max_nights >= min_nights)
      );
    `);
    console.log('✅ promotion_daily_rates 생성 완료');

    console.log('📋 promotion_benefits 테이블 생성...');
    await pool.query(`
      CREATE TABLE promotion_benefits (
        id SERIAL PRIMARY KEY,
        promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
        benefit_type VARCHAR(50) NOT NULL,
        benefit_name VARCHAR(200) NOT NULL,
        benefit_value VARCHAR(200),
        quantity INTEGER DEFAULT 1,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ promotion_benefits 생성 완료');

    console.log('📊 인덱스 생성...');
    await pool.query(`
      DROP INDEX IF EXISTS idx_promotions_code;
      DROP INDEX IF EXISTS idx_promotions_booking_dates;
      DROP INDEX IF EXISTS idx_promotions_stay_dates;
      DROP INDEX IF EXISTS idx_promo_daily_rates_lookup;
      DROP INDEX IF EXISTS idx_promo_daily_rates_date;
      DROP INDEX IF EXISTS idx_promo_daily_rates_nights;
      DROP INDEX IF EXISTS idx_promo_benefits;
      
      CREATE INDEX idx_promotions_code ON promotions(hotel_id, promo_code, is_active);
      CREATE INDEX idx_promotions_booking_dates ON promotions(booking_start_date, booking_end_date);
      CREATE INDEX idx_promotions_stay_dates ON promotions(stay_start_date, stay_end_date);
      CREATE INDEX idx_promo_daily_rates_lookup ON promotion_daily_rates(promotion_id, room_type_id, stay_date);
      CREATE INDEX idx_promo_daily_rates_date ON promotion_daily_rates(stay_date);
      CREATE INDEX idx_promo_daily_rates_nights ON promotion_daily_rates(min_nights, max_nights);
      CREATE INDEX idx_promo_benefits ON promotion_benefits(promotion_id);
    `);
    console.log('✅ 인덱스 생성 완료');

    console.log('⚙️  트리거 생성...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_promotions_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION update_promo_daily_rates_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS promotions_updated_at ON promotions;
      CREATE TRIGGER promotions_updated_at
        BEFORE UPDATE ON promotions
        FOR EACH ROW
        EXECUTE FUNCTION update_promotions_updated_at();

      DROP TRIGGER IF EXISTS promo_daily_rates_updated_at ON promotion_daily_rates;
      CREATE TRIGGER promo_daily_rates_updated_at
        BEFORE UPDATE ON promotion_daily_rates
        FOR EACH ROW
        EXECUTE FUNCTION update_promo_daily_rates_updated_at();
    `);
    console.log('✅ 트리거 생성 완료\n');

    console.log('🎉 모든 테이블 생성 완료!\n');
    
    // 확인
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('promotions', 'promotion_daily_rates', 'promotion_benefits')
      ORDER BY table_name
    `);
    
    console.log('생성된 테이블:');
    result.rows.forEach(row => console.log(`  ✓ ${row.table_name}`));
    
  } catch (error) {
    console.error('\n❌ 오류 발생:', error.message);
    console.error(error);
  } finally {
    await pool.end();
    console.log('\n연결 종료');
  }
}

createTables();
