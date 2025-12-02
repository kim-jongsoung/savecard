const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드
if (fs.existsSync('./railsql.env')) {
    require('dotenv').config({ path: './railsql.env' });
} else {
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addRemittanceRateColumn() {
    try {
        console.log('💰 송금환율 컬럼 추가 시작...\n');
        
        // remittance_rate 컬럼 추가
        await pool.query(`
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
        
        // 확인
        const result = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'hotel_reservations' 
            AND column_name = 'remittance_rate'
        `);
        
        if (result.rows.length > 0) {
            console.log('\n✅ remittance_rate 컬럼 확인:', result.rows[0]);
        } else {
            console.log('\n❌ remittance_rate 컬럼이 없습니다!');
        }
        
    } catch (error) {
        console.error('❌ 오류:', error);
    } finally {
        await pool.end();
    }
}

addRemittanceRateColumn();
