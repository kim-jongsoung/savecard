const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다');
    require('dotenv').config({ path: './railsql.env' });
} else {
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createBookingAgenciesTable() {
    const client = await pool.connect();
    
    try {
        console.log('🏢 거래처 테이블 생성 중...\n');
        
        // booking_agencies 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS booking_agencies (
                id SERIAL PRIMARY KEY,
                agency_code VARCHAR(50) UNIQUE NOT NULL,
                agency_name VARCHAR(200) NOT NULL,
                agency_type VARCHAR(50) DEFAULT 'B2B',
                contact_person VARCHAR(100),
                contact_email VARCHAR(200),
                contact_phone VARCHAR(50),
                margin_rate DECIMAL(5,2) DEFAULT 0.00,
                payment_terms VARCHAR(100),
                bank_account TEXT,
                notes TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ booking_agencies 테이블 생성 완료');
        
        // 인덱스 생성
        try {
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_booking_agencies_code 
                ON booking_agencies(agency_code)
            `);
            console.log('✅ 거래처 코드 인덱스 생성');
        } catch (error) {
            console.log('⚠️ 인덱스 이미 존재 (무시)');
        }
        
        try {
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_booking_agencies_active 
                ON booking_agencies(is_active)
            `);
            console.log('✅ 활성화 상태 인덱스 생성');
        } catch (error) {
            console.log('⚠️ 인덱스 이미 존재 (무시)');
        }
        
        console.log('\n✅ 모든 작업 완료!');
        console.log('\n📋 테이블 구조:');
        console.log('   - agency_code: 거래처 코드 (고유)');
        console.log('   - agency_name: 거래처명');
        console.log('   - agency_type: 거래처 유형 (B2B 등)');
        console.log('   - contact_person: 담당자명');
        console.log('   - contact_email: 이메일');
        console.log('   - contact_phone: 전화번호');
        console.log('   - margin_rate: 마진율 (%)');
        console.log('   - payment_terms: 결제조건');
        console.log('   - bank_account: 계좌번호');
        console.log('   - notes: 메모');
        console.log('   - is_active: 활성화 여부\n');
        
    } catch (error) {
        console.error('❌ 오류:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
if (require.main === module) {
    createBookingAgenciesTable()
        .then(() => {
            console.log('✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { createBookingAgenciesTable };
