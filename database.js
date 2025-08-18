const { Pool } = require('pg');
require('dotenv').config();

// Railway PostgreSQL 연결 설정
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 환경변수 확인
if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL && !process.env.DB_URL) {
  console.warn('⚠️ PostgreSQL 연결 문자열이 설정되지 않았습니다.');
  console.warn('환경변수 DATABASE_URL, POSTGRES_URL, 또는 DB_URL을 설정해주세요.');
}

// 운영 안정화: 필요한 모든 컬럼을 사전에 보정(존재하지 않으면 추가)
async function ensureAllColumns() {
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
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS display_locations INTEGER[] DEFAULT '{1}',
      ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  try {
    const client = await pool.connect();
    console.log('✅ Railway PostgreSQL 연결 성공!');
    client.release();
    return true;
  } catch (err) {
    console.error('❌ 데이터베이스 연결 실패:', err.message);
    return false;
  }
}

// 테이블 생성 함수
async function createTables() {
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
  const fs = require('fs');
  const path = require('path');
  
  try {
    // stores.json 마이그레이션 (테이블 스키마에 맞게 매핑)
    const storesPath = path.join(__dirname, 'data', 'stores.json');
    if (fs.existsSync(storesPath)) {
      const stores = JSON.parse(fs.readFileSync(storesPath, 'utf8'));

      for (const store of stores) {
        await pool.query(`
          INSERT INTO stores (
            name, category, discount, discount_info, address, phone, website, description, image_url, usage_count
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT DO NOTHING
        `, [
          store.name,
          store.category || null,
          // discount 컬럼은 간단 요약, discount_info는 상세 설명으로 매핑
          store.discount || null,
          store.discount_info || null,
          store.location || null,
          store.phone || null,
          store.website || null,
          store.description || null,
          store.imageUrl || null,
          store.usage_count || 0
        ]);
      }
      console.log('✅ 제휴업체 데이터 마이그레이션 완료');
    }

    // partner-applications.json 마이그레이션 (NOT NULL 컬럼 보정: business_name, contact_name, phone)
    const applicationsPath = path.join(__dirname, 'data', 'partner-applications.json');
    if (fs.existsSync(applicationsPath)) {
      const applications = JSON.parse(fs.readFileSync(applicationsPath, 'utf8'));
      
      for (const app of applications) {
        const businessName = app.businessName && String(app.businessName).trim() ? app.businessName : '미기재 업체명';
        const contactName = app.contactName && String(app.contactName).trim() ? app.contactName : '담당자 미기재';
        const phone = app.phone && String(app.phone).trim() ? app.phone : '000-0000-0000';
        await pool.query(`
          INSERT INTO partner_applications (business_name, contact_name, phone, email, business_type, location, discount_offer, additional_info)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT DO NOTHING
        `, [
          businessName,
          contactName,
          phone,
          app.email,
          app.businessType,
          app.location,
          app.discountOffer,
          app.additionalInfo
        ]);
      }
      console.log('✅ 제휴업체 신청 데이터 마이그레이션 완료');
    }

  } catch (err) {
    console.error('❌ 데이터 마이그레이션 실패:', err.message);
  }
}

module.exports = {
  pool,
  testConnection,
  createTables,
  migrateFromJSON,
  ensureAllColumns
};
