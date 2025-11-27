const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드 (railsql.env 우선)
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다 (로컬 Railway 연동)');
    require('dotenv').config({ path: './railsql.env' });
} else {
    console.log('🔧 기본 .env 파일을 사용합니다');
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addSettlementColumns() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🏨 호텔 예약 테이블에 정산 관련 컬럼 추가 시작...\n');
        
        // 정산 관련 컬럼들
        const settlementColumns = [
            { name: 'agency_fee', type: 'DECIMAL(10, 2) DEFAULT 0', comment: '수배피' },
            { name: 'exchange_rate', type: 'DECIMAL(10, 4) DEFAULT 1300', comment: '환율' },
            { name: 'payment_date', type: 'DATE', comment: '입금일' },
            { name: 'transfer_date', type: 'DATE', comment: '송금일' },
            { name: 'settlement_memo', type: 'TEXT', comment: '정산 메모' },
            { name: 'grand_total', type: 'DECIMAL(10, 2)', comment: '총 판매가 (객실+조식+추가+수배피)' }
        ];
        
        for (const col of settlementColumns) {
            // 컬럼 존재 여부 확인 및 추가
            await client.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'hotel_reservations' AND column_name = '${col.name}'
                    ) THEN
                        ALTER TABLE hotel_reservations ADD COLUMN ${col.name} ${col.type};
                        COMMENT ON COLUMN hotel_reservations.${col.name} IS '${col.comment}';
                    END IF;
                END $$;
            `);
            console.log(`✅ ${col.name} 컬럼 추가 완료 (${col.comment})`);
        }
        
        // 기존 데이터에 grand_total 업데이트 (total_selling_price가 있는 경우)
        await client.query(`
            UPDATE hotel_reservations
            SET grand_total = COALESCE(total_selling_price, 0) + COALESCE(agency_fee, 0)
            WHERE grand_total IS NULL AND total_selling_price IS NOT NULL
        `);
        console.log('✅ 기존 데이터 grand_total 업데이트 완료');
        
        await client.query('COMMIT');
        console.log('\n🎉 호텔 정산 컬럼 추가 완료!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 컬럼 추가 실패:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
addSettlementColumns()
    .then(() => {
        console.log('✅ 마이그레이션 완료');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ 마이그레이션 실패:', error);
        process.exit(1);
    });
