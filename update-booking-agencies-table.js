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

async function updateBookingAgenciesTable() {
    const client = await pool.connect();
    
    try {
        console.log('🏢 거래처 테이블 업데이트 중...\n');
        
        // margin_rate 컬럼 삭제 (마진은 요금RAG에서 관리)
        try {
            await client.query(`
                ALTER TABLE booking_agencies 
                DROP COLUMN IF EXISTS margin_rate
            `);
            console.log('✅ margin_rate 컬럼 삭제 (마진은 요금RAG에서 관리)');
        } catch (error) {
            console.log('⚠️ margin_rate 컬럼 없음 (무시)');
        }
        
        try {
            await client.query(`
                ALTER TABLE booking_agencies 
                DROP COLUMN IF EXISTS commission_rate
            `);
            console.log('✅ commission_rate 컬럼 삭제');
        } catch (error) {
            console.log('⚠️ commission_rate 컬럼 없음 (무시)');
        }
        
        console.log('\n✅ 모든 작업 완료!');
        console.log('\n📋 최종 거래처 테이블 구조:');
        console.log('   - agency_code: 거래처 코드');
        console.log('   - agency_name: 거래처명');
        console.log('   - agency_type: 거래처 유형');
        console.log('   - contact_person: 담당자명');
        console.log('   - contact_email: 이메일');
        console.log('   - contact_phone: 전화번호');
        console.log('   - payment_terms: 결제조건');
        console.log('   - bank_account: 계좌번호');
        console.log('   - notes: 메모');
        console.log('   - is_active: 활성화 여부');
        console.log('\n💡 마진/수수료는 요금RAG에서 관리합니다.\n');
        
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
    updateBookingAgenciesTable()
        .then(() => {
            console.log('✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { updateBookingAgenciesTable };
