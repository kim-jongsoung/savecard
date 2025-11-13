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

async function addBookingAgenciesColumns() {
    const client = await pool.connect();
    
    try {
        console.log('🏢 거래처 테이블 컬럼 추가 중...\n');
        
        // bank_account 컬럼 추가
        try {
            await client.query(`
                ALTER TABLE booking_agencies 
                ADD COLUMN IF NOT EXISTS bank_account TEXT
            `);
            console.log('✅ bank_account 컬럼 추가');
        } catch (error) {
            console.log('⚠️ bank_account 컬럼 이미 존재');
        }
        
        // notes 컬럼 추가
        try {
            await client.query(`
                ALTER TABLE booking_agencies 
                ADD COLUMN IF NOT EXISTS notes TEXT
            `);
            console.log('✅ notes 컬럼 추가');
        } catch (error) {
            console.log('⚠️ notes 컬럼 이미 존재');
        }
        
        // payment_terms 컬럼 추가 (없을 수도 있음)
        try {
            await client.query(`
                ALTER TABLE booking_agencies 
                ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100)
            `);
            console.log('✅ payment_terms 컬럼 추가');
        } catch (error) {
            console.log('⚠️ payment_terms 컬럼 이미 존재');
        }
        
        // 필요없는 컬럼 삭제
        try {
            await client.query(`
                ALTER TABLE booking_agencies 
                DROP COLUMN IF EXISTS margin_rate
            `);
            console.log('✅ margin_rate 컬럼 삭제');
        } catch (error) {
            console.log('⚠️ margin_rate 컬럼 없음');
        }
        
        try {
            await client.query(`
                ALTER TABLE booking_agencies 
                DROP COLUMN IF EXISTS commission_rate
            `);
            console.log('✅ commission_rate 컬럼 삭제');
        } catch (error) {
            console.log('⚠️ commission_rate 컬럼 없음');
        }
        
        try {
            await client.query(`
                ALTER TABLE booking_agencies 
                DROP COLUMN IF EXISTS bank_info
            `);
            console.log('✅ bank_info 컬럼 삭제 (bank_account로 대체)');
        } catch (error) {
            console.log('⚠️ bank_info 컬럼 없음');
        }
        
        console.log('\n✅ 모든 작업 완료!\n');
        
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
    addBookingAgenciesColumns()
        .then(() => {
            console.log('✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { addBookingAgenciesColumns };
