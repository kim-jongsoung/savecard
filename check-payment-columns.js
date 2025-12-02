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

async function checkPaymentColumns() {
    try {
        // 1. 컬럼 정보 확인
        console.log('📋 hotel_reservations 테이블의 입금/송금 관련 컬럼 정보:\n');
        
        const columnInfo = await pool.query(`
            SELECT 
                column_name,
                data_type,
                is_nullable,
                column_default,
                character_maximum_length
            FROM information_schema.columns 
            WHERE table_name = 'hotel_reservations' 
            AND column_name IN (
                'payment_received_date', 
                'payment_sent_date',
                'remittance_rate',
                'exchange_rate',
                'status'
            )
            ORDER BY column_name
        `);
        
        if (columnInfo.rows.length === 0) {
            console.log('❌ payment_received_date, payment_sent_date 컬럼이 존재하지 않습니다!');
            console.log('   → add-hotel-settlement-payment-columns.js 실행 필요\n');
        } else {
            console.table(columnInfo.rows);
        }
        
        // 2. 예약 34 상세 정보
        console.log('\n🔍 예약 ID 34 상세 정보:\n');
        
        const reservation = await pool.query(`
            SELECT 
                id, 
                reservation_number, 
                status,
                payment_received_date,
                payment_sent_date,
                check_in_date,
                hotel_id,
                booking_agency_id,
                created_at,
                updated_at
            FROM hotel_reservations 
            WHERE id = 34
        `);
        
        if (reservation.rows.length === 0) {
            console.log('❌ ID 34 예약이 존재하지 않습니다!');
        } else {
            console.log(JSON.stringify(reservation.rows[0], null, 2));
        }
        
        // 3. 수동 업데이트 테스트
        console.log('\n🧪 수동 업데이트 테스트 (예약 34에 오늘 날짜 입력):\n');
        
        const testDate = new Date().toISOString().split('T')[0];
        console.log(`테스트 날짜: ${testDate}`);
        
        try {
            const updateResult = await pool.query(`
                UPDATE hotel_reservations
                SET payment_received_date = $1,
                    updated_at = NOW()
                WHERE id = 34
                RETURNING id, payment_received_date, updated_at
            `, [testDate]);
            
            console.log('✅ 업데이트 성공!');
            console.log(JSON.stringify(updateResult.rows[0], null, 2));
            
            // 롤백
            console.log('\n⏪ 테스트 데이터 롤백 (NULL로 복원)...');
            await pool.query(`
                UPDATE hotel_reservations
                SET payment_received_date = NULL
                WHERE id = 34
            `);
            console.log('✅ 롤백 완료');
            
        } catch (error) {
            console.error('❌ 업데이트 실패:', error.message);
            console.error('   상세:', error);
        }
        
    } catch (error) {
        console.error('❌ 오류:', error);
    } finally {
        await pool.end();
    }
}

checkPaymentColumns();
