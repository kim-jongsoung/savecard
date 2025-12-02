const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다');
    require('dotenv').config({ path: './railsql.env' });
} else {
    console.log('🔧 기본 .env 파일을 사용합니다');
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addSettlementPaymentColumns() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('💰 호텔 정산 입금/송금 컬럼 추가 시작...\n');
        
        // 추가할 컬럼 목록
        const columns = [
            { name: 'payment_received_date', type: 'DATE', comment: '입금일' },
            { name: 'payment_sent_date', type: 'DATE', comment: '송금일' },
            { name: 'remittance_rate', type: 'DECIMAL(10, 4)', comment: '송금환율' },
            { name: 'exchange_rate', type: 'DECIMAL(10, 4)', comment: '정산환율' },
            { name: 'agency_fee', type: 'DECIMAL(10, 2)', comment: '수배피' },
            { name: 'out_hotel_cost', type: 'DECIMAL(10, 2)', comment: '아웃호텔 비용' },
            { name: 'grand_total', type: 'DECIMAL(10, 2)', comment: '총 판매가' },
            { name: 'settlement_memo', type: 'TEXT', comment: '정산 메모' }
        ];
        
        for (const col of columns) {
            // 컬럼 존재 여부 확인
            const checkResult = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'hotel_reservations' 
                AND column_name = $1
            `, [col.name]);
            
            if (checkResult.rows.length === 0) {
                // 컬럼이 없으면 추가
                await client.query(`
                    ALTER TABLE hotel_reservations 
                    ADD COLUMN ${col.name} ${col.type}
                `);
                console.log(`✅ ${col.name} 컬럼 추가 완료 (${col.comment})`);
            } else {
                console.log(`⏭️  ${col.name} 컬럼 이미 존재 (${col.comment})`);
            }
        }
        
        await client.query('COMMIT');
        
        console.log('\n🎉 호텔 정산 입금/송금 컬럼 추가 완료!\n');
        
        // 최종 확인
        const finalCheck = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'hotel_reservations' 
            AND column_name IN (
                'payment_received_date', 
                'payment_sent_date', 
                'remittance_rate',
                'exchange_rate',
                'agency_fee',
                'out_hotel_cost',
                'grand_total',
                'settlement_memo'
            )
            ORDER BY column_name
        `);
        
        console.log('📋 추가된 컬럼 목록:');
        finalCheck.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type}`);
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 컬럼 추가 오류:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
if (require.main === module) {
    addSettlementPaymentColumns()
        .then(() => {
            console.log('\n✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('\n❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { addSettlementPaymentColumns };
