const { Pool } = require('pg');
require('dotenv').config();

// Railway PostgreSQL 연결 설정 (로컬에서는 JSON 모드로 fallback)
let pool = null;
let dbMode = 'json';

try {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_URL) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_URL;
    
    // Railway PostgreSQL은 항상 SSL 필요
    const isRailway = connectionString.includes('railway') || connectionString.includes('metro.proxy.rlwy.net');
    
    pool = new Pool({
      connectionString: connectionString,
      ssl: isRailway ? { rejectUnauthorized: false } : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
      // Railway PostgreSQL 연결 최적화
      max: isRailway ? 5 : 20, // Railway는 연결 수 제한
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      acquireTimeoutMillis: 60000,
      // 연결 재시도 설정
      retryDelayMs: 1000
    });
    dbMode = 'postgresql';
    console.log('✅ PostgreSQL 모드로 실행');
  } else {
    console.log('⚠️ PostgreSQL 연결 정보 없음 - JSON 모드로 fallback');
    dbMode = 'json';
  }
} catch (error) {
  console.warn('⚠️ PostgreSQL 연결 실패 - JSON 모드로 fallback:', error.message);
  dbMode = 'json';
}

// 운영 안정화: 필요한 모든 컬럼을 사전에 보정(존재하지 않으면 추가)
async function ensureAllColumns() {
  if (dbMode !== 'postgresql' || !pool) return;
  const client = await pool.connect();
  try {
    // users
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS agency_id INTEGER,
      ADD COLUMN IF NOT EXISTS token VARCHAR(255),
      ADD COLUMN IF NOT EXISTS qr_code TEXT,
      ADD COLUMN IF NOT EXISTS expiration_start TIMESTAMP,
      ADD COLUMN IF NOT EXISTS expiration_end TIMESTAMP,
      ADD COLUMN IF NOT EXISTS pin VARCHAR(100),
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);
    // 기존에 더 짧게 생성된 경우 타입 확장
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='users' AND column_name='pin' AND character_maximum_length IS NOT NULL AND character_maximum_length < 100
        ) THEN
          ALTER TABLE users ALTER COLUMN pin TYPE VARCHAR(100);
        END IF;
      END$$;
    `);

    // agencies
    await client.query(`
      ALTER TABLE agencies
      ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS discount_info TEXT,
      ADD COLUMN IF NOT EXISTS show_banners_on_landing BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 999,
      ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 999,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    // stores
    await client.query(`
      ALTER TABLE stores
      ADD COLUMN IF NOT EXISTS category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS discount VARCHAR(255),
      ADD COLUMN IF NOT EXISTS discount_info TEXT,
      ADD COLUMN IF NOT EXISTS address VARCHAR(500),
      ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS website VARCHAR(500),
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS image_url VARCHAR(500),
      ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    // usages
    await client.query(`
      ALTER TABLE usages
      ADD COLUMN IF NOT EXISTS token VARCHAR(255),
      ADD COLUMN IF NOT EXISTS store_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
      ADD COLUMN IF NOT EXISTS user_agent TEXT
    `);

    // partner_applications
    await client.query(`
      ALTER TABLE partner_applications
      ADD COLUMN IF NOT EXISTS business_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS business_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS location VARCHAR(255),
      ADD COLUMN IF NOT EXISTS discount_offer TEXT,
      ADD COLUMN IF NOT EXISTS additional_info TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    // banners
    await client.query(`
      ALTER TABLE banners
      ADD COLUMN IF NOT EXISTS advertiser_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS image_url VARCHAR(500),
      ADD COLUMN IF NOT EXISTS link_url VARCHAR(500),
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS display_locations INTEGER[] DEFAULT '{1}',
      ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    // issue_codes
    await client.query(`
      ALTER TABLE issue_codes
      ADD COLUMN IF NOT EXISTS code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS is_used BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS used_by_user_id INTEGER,
      ADD COLUMN IF NOT EXISTS used_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS is_delivered BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP
    `);

    // reservations - 바우처 관련 컬럼
    try {
      await client.query(`
        ALTER TABLE reservations
        ADD COLUMN IF NOT EXISTS voucher_token VARCHAR(100) UNIQUE,
        ADD COLUMN IF NOT EXISTS qr_code_data TEXT,
        ADD COLUMN IF NOT EXISTS qr_image_path VARCHAR(255),
        ADD COLUMN IF NOT EXISTS vendor_voucher_path VARCHAR(255),
        ADD COLUMN IF NOT EXISTS voucher_sent_at TIMESTAMP
      `);
      
      // 인덱스 생성
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_reservations_voucher_token 
        ON reservations(voucher_token)
      `);
      
      console.log('✅ reservations 테이블 바우처 컬럼 추가 완료');
    } catch (err) {
      // reservations 테이블이 없으면 무시
      if (err.code !== '42P01') { // 42P01 = undefined_table
        console.warn('⚠️ reservations 컬럼 추가 경고:', err.message);
      }
    }

    console.log('🛠️ 모든 테이블 컬럼 보정 완료');
  } catch (err) {
    console.warn('⚠️ 컬럼 보정 중 경고:', err.message);
  } finally {
    client.release();
  }
}

// 데이터베이스 연결 테스트
async function testConnection() {
  if (dbMode !== 'postgresql' || !pool) {
    console.log('📋 JSON 모드로 실행 중 - 데이터베이스 연결 테스트 건너뜀');
    return true;
  }
  try {
    const client = await pool.connect();
    console.log('✅ Railway PostgreSQL 연결 성공!');
    client.release();
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL 연결 실패:', err.message);
    return false;
  }
}

// 테이블 생성 함수
async function createTables() {
  if (dbMode !== 'postgresql' || !pool) {
    console.log('📋 JSON 모드로 실행 중 - 테이블 생성 건너뜀');
    return;
  }
  const client = await pool.connect();
  
  try {
    // 제휴업체 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        discount VARCHAR(255),
        discount_info TEXT,
        address VARCHAR(500),
        phone VARCHAR(50),
        website VARCHAR(500),
        description TEXT,
        image_url VARCHAR(500),
        usage_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 제휴업체 신청 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS partner_applications (
        id SERIAL PRIMARY KEY,
        business_name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(255),
        business_type VARCHAR(100),
        location VARCHAR(255),
        discount_offer TEXT,
        additional_info TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 여행사 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS agencies (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        contact_email VARCHAR(255),
        contact_phone VARCHAR(50),
        discount_info TEXT,
        show_banners_on_landing BOOLEAN DEFAULT true,
        display_order INTEGER DEFAULT 999,
        sort_order INTEGER DEFAULT 999,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 카드 사용자 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        email VARCHAR(255),
        agency_id INTEGER REFERENCES agencies(id),
        token VARCHAR(255) UNIQUE NOT NULL,
        qr_code TEXT,
        expiration_start TIMESTAMP,
        expiration_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 카드 비밀번호(PIN) 컬럼 추가 (없으면 추가)
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS pin VARCHAR(100)
    `);

    // 카드 사용 이력 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS usages (
        id SERIAL PRIMARY KEY,
        token VARCHAR(255) NOT NULL,
        store_name VARCHAR(255) NOT NULL,
        used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT
      )
    `);

    // 배너 테이블 (지난주 완성된 구조)
    await client.query(`
      CREATE TABLE IF NOT EXISTS banners (
        id SERIAL PRIMARY KEY,
        advertiser_name VARCHAR(255) NOT NULL,
        image_url VARCHAR(500) NOT NULL,
        link_url VARCHAR(500),
        is_active BOOLEAN DEFAULT true,
        display_order INTEGER DEFAULT 0,
        display_locations INTEGER[] DEFAULT '{1}',
        click_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 발급 코드 테이블 생성
    await client.query(`
      CREATE TABLE IF NOT EXISTS issue_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(10) UNIQUE NOT NULL,
        is_used BOOLEAN DEFAULT FALSE,
        used_by_user_id INTEGER REFERENCES users(id),
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_delivered BOOLEAN DEFAULT FALSE,
        delivered_at TIMESTAMP
      );
    `);
    console.log('✅ issue_codes 테이블 생성 완료');

    // 예약 드래프트 테이블 생성 (검수형 워크플로우)
    await client.query(`
      CREATE TABLE IF NOT EXISTS reservation_drafts (
        draft_id SERIAL PRIMARY KEY,
        raw_text TEXT NOT NULL,
        parsed_json JSONB,
        normalized_json JSONB,
        manual_json JSONB,
        confidence DECIMAL(3,2) DEFAULT 0.8,
        extracted_notes TEXT,
        status VARCHAR(20) DEFAULT 'pending_review',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_by VARCHAR(100),
        reviewed_at TIMESTAMP,
        committed_reservation_id INTEGER
      )
    `);
    console.log('✅ reservation_drafts 테이블 생성 완료');

    // 단일 통합 예약 테이블 생성 (모든 정보를 하나의 테이블에)
    await client.query(`
        CREATE TABLE IF NOT EXISTS reservations (
            id SERIAL PRIMARY KEY,
            reservation_number VARCHAR(100) UNIQUE NOT NULL,
            channel VARCHAR(50) DEFAULT '웹',
            platform_name VARCHAR(50) DEFAULT 'NOL',
            product_name VARCHAR(200),
            
            -- 예약자 정보
            korean_name VARCHAR(100),
            english_first_name VARCHAR(100),
            english_last_name VARCHAR(100),
            phone VARCHAR(50),
            email VARCHAR(200),
            kakao_id VARCHAR(100),
            
            -- 이용 정보
            usage_date DATE,
            usage_time TIME,
            guest_count INTEGER DEFAULT 1,
            people_adult INTEGER DEFAULT 1,
            people_child INTEGER DEFAULT 0,
            people_infant INTEGER DEFAULT 0,
            package_type VARCHAR(50),
            
            -- 결제 정보
            total_amount DECIMAL(12,2),
            adult_unit_price DECIMAL(10,2) DEFAULT 0,
            child_unit_price DECIMAL(10,2) DEFAULT 0,
            payment_status VARCHAR(20) DEFAULT '대기',
            
            -- 코드 발급 정보
            code_issued BOOLEAN DEFAULT FALSE,
            code_issued_at TIMESTAMP,
            
            -- 기타
            memo TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ 통합 reservations 테이블 생성 완료');

    console.log('✅ reservations 테이블 생성 완료');

    // 바우처 전송 기록 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS voucher_sends (
        id SERIAL PRIMARY KEY,
        reservation_id INTEGER NOT NULL,
        voucher_token VARCHAR(100),
        send_method VARCHAR(20) NOT NULL,
        recipient VARCHAR(255),
        subject VARCHAR(255),
        message TEXT,
        sent_by VARCHAR(100),
        status VARCHAR(20) DEFAULT 'sent',
        sent_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ voucher_sends 테이블 생성 완료');

    // 바우처 열람 기록 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS voucher_views (
        id SERIAL PRIMARY KEY,
        voucher_token VARCHAR(100) NOT NULL,
        reservation_id INTEGER,
        ip_address VARCHAR(50),
        user_agent TEXT,
        device_type VARCHAR(20),
        viewed_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ voucher_views 테이블 생성 완료');

  } catch (err) {
    console.error('❌ 테이블 생성 실패:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// 기존 JSON 데이터를 PostgreSQL로 마이그레이션
async function migrateFromJSON() {
  if (dbMode !== 'postgresql' || !pool) {
    console.log('📋 JSON 모드로 실행 중 - 마이그레이션 건너뜀');
    return;
  }
  
  const fs = require('fs');
  const path = require('path');
  
  try {
    // stores.json 마이그레이션 비활성화 (수동 등록으로 변경)
    console.log('⏭️ 제휴업체 자동 마이그레이션 건너뜀 (수동 등록 모드)');

    // partner-applications.json 마이그레이션 비활성화 (자동 누적 방지)
    console.log('⏭️ 제휴업체 신청 자동 마이그레이션 건너뜀 (수동 등록 모드)');

  } catch (err) {
    console.error('❌ 데이터 마이그레이션 실패:', err.message);
  }
}

module.exports = {
  pool,
  dbMode,
  testConnection,
  createTables,
  ensureAllColumns,
  migrateFromJSON
};
