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

async function checkSettlementColumns() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 호텔 예약 테이블 정산 컬럼 확인 중...\n');
        
        // hotel_reservations 테이블의 모든 컬럼 조회
        const query = `
            SELECT 
                column_name,
                data_type,
                column_default,
                is_nullable,
                character_maximum_length,
                numeric_precision,
                numeric_scale
            FROM information_schema.columns
            WHERE table_name = 'hotel_reservations'
            AND column_name IN ('agency_fee', 'exchange_rate', 'payment_date', 'transfer_date', 'settlement_memo', 'grand_total')
            ORDER BY column_name;
        `;
        
        const result = await client.query(query);
        
        console.log('📊 정산 관련 컬럼 상태:\n');
        console.log('='.repeat(80));
        
        if (result.rows.length === 0) {
            console.log('❌ 정산 관련 컬럼이 하나도 없습니다!');
            console.log('   마이그레이션이 필요합니다.');
        } else {
            result.rows.forEach(col => {
                console.log(`\n✅ ${col.column_name}`);
                console.log(`   타입: ${col.data_type}`);
                if (col.numeric_precision) {
                    console.log(`   정밀도: ${col.numeric_precision},${col.numeric_scale}`);
                }
                console.log(`   기본값: ${col.column_default || 'NULL'}`);
                console.log(`   NULL 허용: ${col.is_nullable}`);
            });
            
            console.log('\n' + '='.repeat(80));
            console.log(`\n총 ${result.rows.length}개의 정산 컬럼이 존재합니다.`);
            
            // 필요한 컬럼 체크
            const requiredColumns = ['agency_fee', 'exchange_rate', 'payment_date', 'transfer_date', 'settlement_memo', 'grand_total'];
            const existingColumns = result.rows.map(r => r.column_name);
            const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
            
            if (missingColumns.length > 0) {
                console.log('\n⚠️  누락된 컬럼:');
                missingColumns.forEach(col => console.log(`   - ${col}`));
            } else {
                console.log('\n🎉 모든 정산 컬럼이 정상적으로 존재합니다!');
            }
        }
        
        // 샘플 데이터 확인
        console.log('\n\n📋 샘플 데이터 확인 (최근 5개 예약):\n');
        console.log('='.repeat(80));
        
        const sampleQuery = `
            SELECT 
                id,
                reservation_number,
                status,
                total_selling_price,
                total_cost_price,
                agency_fee,
                exchange_rate,
                grand_total,
                payment_date,
                transfer_date
            FROM hotel_reservations
            ORDER BY created_at DESC
            LIMIT 5;
        `;
        
        const sampleResult = await client.query(sampleQuery);
        
        if (sampleResult.rows.length === 0) {
            console.log('ℹ️  예약 데이터가 없습니다.');
        } else {
            sampleResult.rows.forEach((row, idx) => {
                console.log(`\n[${idx + 1}] 예약번호: ${row.reservation_number || 'N/A'}`);
                console.log(`    상태: ${row.status}`);
                console.log(`    판매가: $${row.total_selling_price || 0}`);
                console.log(`    매입가: $${row.total_cost_price || 0}`);
                console.log(`    수배피: ₩${row.agency_fee || 0}`);
                console.log(`    환율: ${row.exchange_rate || 'N/A'}`);
                console.log(`    총액: $${row.grand_total || 0}`);
                console.log(`    입금일: ${row.payment_date || '미입금'}`);
                console.log(`    송금일: ${row.transfer_date || '미송금'}`);
            });
        }
        
        console.log('\n' + '='.repeat(80));
        
    } catch (error) {
        console.error('❌ 확인 중 오류 발생:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
checkSettlementColumns()
    .then(() => {
        console.log('\n✅ 확인 완료');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ 확인 실패:', error);
        process.exit(1);
    });
