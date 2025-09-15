const { Pool } = require('pg');
require('dotenv').config();

// Railway PostgreSQL 연결 설정 (로컬에서는 JSON 모드로 fallback)
let pool = null;
let dbMode = 'json';

try {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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

    // 발급 코드 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS issue_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(10) UNIQUE NOT NULL,
        is_used BOOLEAN DEFAULT FALSE,
        used_by_user_id INTEGER REFERENCES users(id),
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        notes TEXT,
        is_delivered BOOLEAN DEFAULT FALSE,
        delivered_at TIMESTAMP
      )
    `);

    console.log('✅ 모든 테이블이 성공적으로 생성되었습니다!');
    
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
