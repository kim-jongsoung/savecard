const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드 (railsql.env 우선)
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다');
    require('dotenv').config({ path: './railsql.env' });
} else {
    require('dotenv').config();
}

// Railway PostgreSQL 연결 설정
const connectionString = process.env.DATABASE_URL;
const isRailway = connectionString && (connectionString.includes('railway') || connectionString.includes('metro.proxy.rlwy.net'));

const pool = new Pool({
    connectionString: connectionString,
    ssl: isRailway ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

async function createVendorsTables() {
    try {
        console.log('🏢 수배업체 테이블 수동 생성 시작...');
        
        // 1. vendors 테이블 생성
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vendors (
                id SERIAL PRIMARY KEY,
                vendor_name VARCHAR(100) NOT NULL UNIQUE,
                vendor_id VARCHAR(50) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                email VARCHAR(100) NOT NULL,
                phone VARCHAR(20),
                contact_person VARCHAR(50),
                business_type VARCHAR(50),
                description TEXT,
                notification_email VARCHAR(100),
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('✅ vendors 테이블 생성 완료');
        
        // 2. vendor_products 테이블 생성
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vendor_products (
                id SERIAL PRIMARY KEY,
                vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
                product_keyword VARCHAR(100) NOT NULL,
                priority INTEGER DEFAULT 1,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(vendor_id, product_keyword)
            );
        `);
        console.log('✅ vendor_products 테이블 생성 완료');
        
        // 3. assignments 테이블에 vendor_id 컬럼 추가 (없는 경우)
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'vendor_id'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN vendor_id INTEGER;
                    RAISE NOTICE 'vendor_id 컬럼이 assignments 테이블에 추가되었습니다.';
                ELSE
                    RAISE NOTICE 'vendor_id 컬럼이 이미 존재합니다.';
                END IF;
            END $$;
        `);
        console.log('✅ assignments 테이블 vendor_id 컬럼 확인 완료');
        
        // 4. 테이블 존재 확인
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('vendors', 'vendor_products')
            ORDER BY table_name;
        `);
        
        console.log('📊 생성된 테이블들:');
        result.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}`);
        });
        
        console.log('🎉 수배업체 테이블 생성 완료!');
        
    } catch (error) {
        console.error('❌ 테이블 생성 실패:', error);
    } finally {
        await pool.end();
    }
}

// 스크립트 실행
createVendorsTables();
