const { Pool } = require('pg');

// PostgreSQL 연결 풀
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * 드래프트 시스템용 테이블 생성
 */
async function createDraftTables() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 드래프트 시스템 테이블 생성 중...');
        
        // reservation_drafts 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS reservation_drafts (
                draft_id SERIAL PRIMARY KEY,
                raw_text TEXT NOT NULL,
                parsed_json JSONB,
                normalized_json JSONB,
                manual_json JSONB,
                flags JSONB DEFAULT '{}',
                confidence DECIMAL(3,2) DEFAULT 0.0,
                status VARCHAR(20) DEFAULT 'draft',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        // reservations 테이블 (기존 스키마 유지하되 필요한 컬럼 추가)
        await client.query(`
            CREATE TABLE IF NOT EXISTS reservations (
                id SERIAL PRIMARY KEY,
                reservation_number VARCHAR(100) UNIQUE NOT NULL,
                confirmation_number VARCHAR(100),
                channel VARCHAR(50) DEFAULT '웹',
                product_name VARCHAR(200),
                total_amount DECIMAL(10,2),
                package_type VARCHAR(100),
                usage_date DATE,
                usage_time TIME,
                quantity INTEGER DEFAULT 1,
                korean_name VARCHAR(100),
                english_first_name VARCHAR(100),
                english_last_name VARCHAR(100),
                email VARCHAR(200),
                phone VARCHAR(50),
                kakao_id VARCHAR(100),
                guest_count INTEGER DEFAULT 1,
                memo TEXT,
                reservation_datetime TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                issue_code_id INTEGER,
                code_issued BOOLEAN DEFAULT FALSE,
                code_issued_at TIMESTAMP,
                platform_name VARCHAR(50) DEFAULT 'NOL',
                people_adult INTEGER DEFAULT 1,
                people_child INTEGER DEFAULT 0,
                people_infant INTEGER DEFAULT 0,
                adult_unit_price DECIMAL(10,2),
                child_unit_price DECIMAL(10,2),
                payment_status VARCHAR(20) DEFAULT 'pending'
            )
        `);
        
        // 인덱스 생성
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_drafts_status ON reservation_drafts(status);
            CREATE INDEX IF NOT EXISTS idx_drafts_created ON reservation_drafts(created_at);
            CREATE INDEX IF NOT EXISTS idx_reservations_number ON reservations(reservation_number);
            CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(payment_status);
        `);
        
        // updated_at 자동 업데이트 트리거 함수
        await client.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ language 'plpgsql';
        `);
        
        // 트리거 생성
        await client.query(`
            DROP TRIGGER IF EXISTS update_drafts_updated_at ON reservation_drafts;
            CREATE TRIGGER update_drafts_updated_at
                BEFORE UPDATE ON reservation_drafts
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
                
            DROP TRIGGER IF EXISTS update_reservations_updated_at ON reservations;
            CREATE TRIGGER update_reservations_updated_at
                BEFORE UPDATE ON reservations
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `);
        
        console.log('✅ 드래프트 시스템 테이블 생성 완료');
        
    } catch (error) {
        console.error('❌ 테이블 생성 오류:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * 데이터베이스 연결 테스트
 */
async function testConnection() {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        console.log('✅ PostgreSQL 연결 성공:', result.rows[0].now);
        client.release();
        return true;
    } catch (error) {
        console.error('❌ PostgreSQL 연결 실패:', error.message);
        return false;
    }
}

module.exports = {
    pool,
    createDraftTables,
    testConnection
};
