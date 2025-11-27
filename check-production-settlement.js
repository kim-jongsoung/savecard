const { Pool } = require('pg');
const fs = require('fs');

// 프로덕션 환경변수 사용
console.log('🚀 Railway 프로덕션 데이터베이스 접속 중...\n');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkProductionSettlement() {
    const client = await pool.connect();
    
    try {
        console.log('✅ Railway 데이터베이스 연결 성공!\n');
        
        // 1. 데이터베이스 정보 확인
        const dbInfo = await client.query(`
            SELECT current_database() as database, 
                   current_user as user,
                   version() as version
        `);
        console.log('📊 데이터베이스 정보:');
        console.log(`   데이터베이스: ${dbInfo.rows[0].database}`);
        console.log(`   사용자: ${dbInfo.rows[0].user}`);
        console.log(`   버전: ${dbInfo.rows[0].version.split(',')[0]}\n`);
        
        // 2. hotel_reservations 테이블 존재 확인
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'hotel_reservations'
            ) as exists;
        `);
        
        if (!tableCheck.rows[0].exists) {
            console.log('❌ hotel_reservations 테이블이 존재하지 않습니다!');
            return;
        }
        
        console.log('✅ hotel_reservations 테이블 존재 확인\n');
        
        // 3. 정산 컬럼 확인
        console.log('🔍 정산 관련 컬럼 확인 중...\n');
        console.log('='.repeat(80));
        
        const query = `
            SELECT 
                column_name,
                data_type,
                column_default,
                is_nullable,
                numeric_precision,
                numeric_scale
            FROM information_schema.columns
            WHERE table_name = 'hotel_reservations'
            AND column_name IN ('agency_fee', 'exchange_rate', 'payment_date', 'transfer_date', 'settlement_memo', 'grand_total')
            ORDER BY column_name;
        `;
        
        const result = await client.query(query);
        
        if (result.rows.length === 0) {
            console.log('❌ 정산 관련 컬럼이 하나도 없습니다!');
            console.log('   서버 재시작 후 자동 마이그레이션이 실행됩니다.');
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
                console.log('\n💡 서버 재시작 시 자동으로 추가됩니다.');
            } else {
                console.log('\n🎉 모든 정산 컬럼이 정상적으로 존재합니다!');
            }
        }
        
        // 4. 예약 데이터 통계
        console.log('\n\n📊 호텔 예약 통계:\n');
        console.log('='.repeat(80));
        
        const statsQuery = `
            SELECT 
                COUNT(*) as total_reservations,
                COUNT(CASE WHEN status = 'voucher' THEN 1 END) as voucher_sent,
                COUNT(CASE WHEN status = 'settlement' THEN 1 END) as settlement_ready,
                COUNT(CASE WHEN payment_date IS NOT NULL THEN 1 END) as paid,
                COUNT(CASE WHEN transfer_date IS NOT NULL THEN 1 END) as transferred
            FROM hotel_reservations;
        `;
        
        const stats = await client.query(statsQuery);
        const s = stats.rows[0];
        
        console.log(`   총 예약: ${s.total_reservations}건`);
        console.log(`   바우처 전송: ${s.voucher_sent}건`);
        console.log(`   정산 대기: ${s.settlement_ready}건`);
        console.log(`   입금 완료: ${s.paid}건`);
        console.log(`   송금 완료: ${s.transferred}건`);
        
        // 5. 최근 예약 샘플
        console.log('\n\n📋 최근 예약 샘플 (3건):\n');
        console.log('='.repeat(80));
        
        const sampleQuery = `
            SELECT 
                reservation_number,
                status,
                check_in_date,
                total_selling_price,
                agency_fee,
                exchange_rate,
                grand_total,
                payment_date,
                transfer_date
            FROM hotel_reservations
            ORDER BY created_at DESC
            LIMIT 3;
        `;
        
        const samples = await client.query(sampleQuery);
        
        if (samples.rows.length === 0) {
            console.log('ℹ️  예약 데이터가 없습니다.');
        } else {
            samples.rows.forEach((row, idx) => {
                console.log(`\n[${idx + 1}] ${row.reservation_number || 'N/A'}`);
                console.log(`    체크인: ${row.check_in_date || 'N/A'}`);
                console.log(`    상태: ${row.status}`);
                console.log(`    판매가: $${row.total_selling_price || 0}`);
                console.log(`    수배피: ₩${row.agency_fee || 0}`);
                console.log(`    환율: ${row.exchange_rate || 'N/A'}`);
                console.log(`    총액: $${row.grand_total || 0}`);
                console.log(`    입금: ${row.payment_date || '미입금'}`);
                console.log(`    송금: ${row.transfer_date || '미송금'}`);
            });
        }
        
        console.log('\n' + '='.repeat(80));
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
checkProductionSettlement()
    .then(() => {
        console.log('\n✅ Railway 프로덕션 확인 완료');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ 확인 실패:', error);
        process.exit(1);
    });
