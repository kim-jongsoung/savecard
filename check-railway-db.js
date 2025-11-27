const { Pool } = require('pg');

console.log('🚀 Railway 데이터베이스 접속 중...\n');

// Railway TCP 프록시를 통한 접속
const pool = new Pool({
    host: 'metro.proxy.rlwy.net',
    port: 25887,
    user: 'postgres',
    password: 'UWGlOaPdwvynoOILFdKfbNyJjmPPjgcg',
    database: 'railway',
    ssl: false
});

async function checkRailwayDB() {
    const client = await pool.connect();
    
    try {
        console.log('✅ Railway 데이터베이스 연결 성공!\n');
        
        // 1. hotel_reservations 테이블 존재 확인
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
        
        // 2. 정산 컬럼 확인
        console.log('🔍 정산 관련 컬럼 확인:\n');
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
            console.log('❌ 정산 관련 컬럼이 없습니다!');
            console.log('   서버가 재시작되면 자동으로 추가됩니다.\n');
            
            // 전체 컬럼 목록 확인
            const allColumns = await client.query(`
                SELECT column_name 
                FROM information_schema.columns
                WHERE table_name = 'hotel_reservations'
                ORDER BY ordinal_position;
            `);
            
            console.log('📋 현재 hotel_reservations 테이블의 컬럼 목록:');
            allColumns.rows.forEach((col, idx) => {
                console.log(`   ${idx + 1}. ${col.column_name}`);
            });
        } else {
            result.rows.forEach(col => {
                console.log(`\n✅ ${col.column_name}`);
                console.log(`   타입: ${col.data_type}`);
                if (col.numeric_precision) {
                    console.log(`   정밀도: ${col.numeric_precision},${col.numeric_scale}`);
                }
                console.log(`   기본값: ${col.column_default || 'NULL'}`);
            });
            
            console.log('\n' + '='.repeat(80));
            console.log(`\n🎉 총 ${result.rows.length}개의 정산 컬럼이 존재합니다!`);
        }
        
        // 3. 예약 통계
        console.log('\n\n📊 호텔 예약 통계:\n');
        console.log('='.repeat(80));
        
        const statsQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'voucher' THEN 1 END) as voucher,
                COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled
            FROM hotel_reservations;
        `;
        
        const stats = await client.query(statsQuery);
        const s = stats.rows[0];
        
        console.log(`   총 예약: ${s.total}건`);
        console.log(`   바우처 전송: ${s.voucher}건`);
        console.log(`   확정: ${s.confirmed}건`);
        console.log(`   취소: ${s.cancelled}건`);
        
        // 4. 최근 예약 3건
        console.log('\n\n📋 최근 예약 3건:\n');
        console.log('='.repeat(80));
        
        const sampleQuery = `
            SELECT 
                reservation_number,
                status,
                check_in_date,
                total_selling_price,
                created_at
            FROM hotel_reservations
            ORDER BY created_at DESC
            LIMIT 3;
        `;
        
        const samples = await client.query(sampleQuery);
        
        samples.rows.forEach((row, idx) => {
            console.log(`\n[${idx + 1}] ${row.reservation_number || 'N/A'}`);
            console.log(`    상태: ${row.status}`);
            console.log(`    체크인: ${row.check_in_date}`);
            console.log(`    판매가: $${row.total_selling_price || 0}`);
            console.log(`    생성일: ${row.created_at}`);
        });
        
        console.log('\n' + '='.repeat(80));
        
    } catch (error) {
        console.error('❌ 오류:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

checkRailwayDB()
    .then(() => {
        console.log('\n✅ 확인 완료');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ 실패:', error);
        process.exit(1);
    });
