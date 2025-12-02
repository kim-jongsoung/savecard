const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' }); // Railway DB 사용

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addRemittanceRateToProduction() {
    try {
        console.log('🚀 Railway 프로덕션 DB에 remittance_rate 컬럼 추가...\n');
        console.log('📍 DB URL:', process.env.DATABASE_URL?.substring(0, 30) + '...');
        
        // remittance_rate 컬럼 추가
        const result = await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'hotel_reservations' 
                    AND column_name = 'remittance_rate'
                ) THEN
                    ALTER TABLE hotel_reservations 
                    ADD COLUMN remittance_rate DECIMAL(10, 4);
                    RAISE NOTICE '✅ remittance_rate 컬럼 추가 완료';
                ELSE
                    RAISE NOTICE '⏭️ remittance_rate 컬럼 이미 존재';
                END IF;
            END $$;
        `);
        
        console.log('✅ 실행 완료');
        
        // 확인
        const checkResult = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'hotel_reservations' 
            AND column_name IN ('remittance_rate', 'payment_received_date', 'payment_sent_date')
            ORDER BY column_name
        `);
        
        console.log('\n📋 정산 관련 컬럼 확인:');
        console.table(checkResult.rows);
        
        // 테스트 데이터 확인
        const testResult = await pool.query(`
            SELECT id, reservation_number, status, 
                   payment_received_date, payment_sent_date, remittance_rate
            FROM hotel_reservations 
            WHERE status IN ('settlement', 'completed')
            LIMIT 3
        `);
        
        console.log('\n🔍 샘플 데이터:');
        console.table(testResult.rows);
        
    } catch (error) {
        console.error('❌ 오류:', error.message);
        console.error(error);
    } finally {
        await pool.end();
    }
}

addRemittanceRateToProduction();
