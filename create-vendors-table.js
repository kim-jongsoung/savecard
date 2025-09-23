const { Pool } = require('pg');

// PostgreSQL 연결 설정
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * 수배업체 테이블 생성 스크립트
 * 
 * 수배업체 관리를 위한 vendors 테이블과 관련 테이블들을 생성합니다.
 * - vendors: 수배업체 기본 정보
 * - vendor_products: 업체별 담당 상품 매핑
 * - assignments: 수배 배정 내역 (기존 테이블 확장)
 */

async function createVendorsTable() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🏢 수배업체 관리 테이블 생성 시작...');
        
        // 1. vendors 테이블 생성 (수배업체 기본 정보)
        await client.query(`
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
        
        // 2. vendor_products 테이블 생성 (업체별 담당 상품 매핑)
        await client.query(`
            CREATE TABLE IF NOT EXISTS vendor_products (
                id SERIAL PRIMARY KEY,
                vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
                product_keyword VARCHAR(200) NOT NULL,
                priority INTEGER DEFAULT 1,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(vendor_id, product_keyword)
            );
        `);
        console.log('✅ vendor_products 테이블 생성 완료');
        
        // 3. assignments 테이블 확장 (수배 배정 내역)
        await client.query(`
            CREATE TABLE IF NOT EXISTS assignments (
                id SERIAL PRIMARY KEY,
                reservation_id INTEGER,
                vendor_id INTEGER REFERENCES vendors(id),
                assigned_by VARCHAR(100),
                assigned_at TIMESTAMP DEFAULT NOW(),
                status VARCHAR(20) DEFAULT 'pending',
                notes TEXT,
                cost_amount DECIMAL(10,2),
                cost_currency VARCHAR(3) DEFAULT 'USD',
                voucher_number VARCHAR(100),
                voucher_url TEXT,
                voucher_issued_at TIMESTAMP,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('✅ assignments 테이블 생성 완료');
        
        // 4. 인덱스 생성
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_vendors_vendor_id ON vendors(vendor_id);
            CREATE INDEX IF NOT EXISTS idx_vendors_active ON vendors(is_active);
            CREATE INDEX IF NOT EXISTS idx_vendor_products_vendor ON vendor_products(vendor_id);
            CREATE INDEX IF NOT EXISTS idx_vendor_products_keyword ON vendor_products(product_keyword);
            CREATE INDEX IF NOT EXISTS idx_assignments_reservation ON assignments(reservation_id);
            CREATE INDEX IF NOT EXISTS idx_assignments_vendor ON assignments(vendor_id);
            CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);
        `);
        console.log('✅ 인덱스 생성 완료');
        
        // 5. 샘플 수배업체 데이터 삽입
        await client.query(`
            INSERT INTO vendors (vendor_name, vendor_id, password_hash, email, phone, contact_person, business_type, description, notification_email)
            VALUES 
                ('돌핀크루즈', 'dolphin_cruise', '$2b$10$example_hash_1', 'info@dolphincruise.com', '671-555-0101', '김선장', '해양관광', '괌 돌핀 크루즈 전문 업체', 'booking@dolphincruise.com'),
                ('괌 공연장', 'guam_theater', '$2b$10$example_hash_2', 'contact@guamtheater.com', '671-555-0102', '박매니저', '공연/엔터테인먼트', '괌 각종 공연 및 쇼 운영', 'reservations@guamtheater.com'),
                ('정글리버크루즈', 'jungle_river', '$2b$10$example_hash_3', 'info@jungleriver.com', '671-555-0103', '이가이드', '자연관광', '정글리버 투어 전문', 'tours@jungleriver.com'),
                ('괌 골프장', 'guam_golf', '$2b$10$example_hash_4', 'pro@guamgolf.com', '671-555-0104', '최프로', '골프/스포츠', '괌 프리미엄 골프장', 'booking@guamgolf.com')
            ON CONFLICT (vendor_id) DO NOTHING;
        `);
        console.log('✅ 샘플 수배업체 데이터 삽입 완료');
        
        // 6. 업체별 담당 상품 매핑 샘플 데이터
        await client.query(`
            INSERT INTO vendor_products (vendor_id, product_keyword, priority)
            SELECT v.id, keyword, priority
            FROM vendors v
            CROSS JOIN (VALUES
                ('돌핀크루즈', '돌핀', 1),
                ('돌핀크루즈', 'dolphin', 1),
                ('돌핀크루즈', '크루즈', 2),
                ('괌 공연장', '공연', 1),
                ('괌 공연장', '쇼', 1),
                ('괌 공연장', 'show', 1),
                ('괌 공연장', '매직', 2),
                ('정글리버크루즈', '정글리버', 1),
                ('정글리버크루즈', 'jungle', 1),
                ('정글리버크루즈', '맹글로브', 2),
                ('괌 골프장', '골프', 1),
                ('괌 골프장', 'golf', 1)
            ) AS products(vendor_name, keyword, priority)
            WHERE v.vendor_name = products.vendor_name
            ON CONFLICT (vendor_id, product_keyword) DO NOTHING;
        `);
        console.log('✅ 업체별 상품 매핑 샘플 데이터 삽입 완료');
        
        await client.query('COMMIT');
        console.log('🎉 수배업체 관리 시스템 테이블 생성 완료!');
        
        // 생성된 데이터 확인
        const vendorCount = await client.query('SELECT COUNT(*) FROM vendors');
        const productMappingCount = await client.query('SELECT COUNT(*) FROM vendor_products');
        
        console.log(`📊 생성된 수배업체: ${vendorCount.rows[0].count}개`);
        console.log(`📊 상품 매핑: ${productMappingCount.rows[0].count}개`);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 테이블 생성 실패:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 테이블 삭제 함수 (개발용)
async function dropVendorsTable() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🗑️ 수배업체 테이블 삭제 시작...');
        
        await client.query('DROP TABLE IF EXISTS assignments CASCADE');
        await client.query('DROP TABLE IF EXISTS vendor_products CASCADE');
        await client.query('DROP TABLE IF EXISTS vendors CASCADE');
        
        await client.query('COMMIT');
        console.log('✅ 수배업체 테이블 삭제 완료');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 테이블 삭제 실패:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 스크립트 실행
if (require.main === module) {
    const action = process.argv[2];
    
    if (action === 'drop') {
        dropVendorsTable()
            .then(() => {
                console.log('수배업체 테이블 삭제 완료');
                process.exit(0);
            })
            .catch(error => {
                console.error('삭제 실패:', error);
                process.exit(1);
            });
    } else {
        createVendorsTable()
            .then(() => {
                console.log('수배업체 테이블 생성 완료');
                process.exit(0);
            })
            .catch(error => {
                console.error('생성 실패:', error);
                process.exit(1);
            });
    }
}

module.exports = {
    createVendorsTable,
    dropVendorsTable
};
