require('dotenv').config();
require('dotenv').config({ path: 'railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addReservationDateColumn() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 hotel_reservations 테이블에 reservation_date 컬럼 추가 시작...');
        
        await client.query('BEGIN');
        
        // 1. reservation_date 컬럼 확인
        const checkColumn = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'hotel_reservations' 
            AND column_name = 'reservation_date'
        `);
        
        if (checkColumn.rows.length > 0) {
            console.log('✅ reservation_date 컬럼이 이미 존재합니다.');
        } else {
            console.log('⚠️ reservation_date 컬럼이 없습니다. 추가 중...');
            
            // 2. 컬럼 추가 (인박스 입력일 = 예약 등록일)
            await client.query(`
                ALTER TABLE hotel_reservations 
                ADD COLUMN reservation_date DATE DEFAULT CURRENT_DATE
            `);
            
            console.log('✅ reservation_date 컬럼 추가 완료!');
            
            // 3. 기존 데이터에 reservation_date 채우기 (created_at 날짜 기준)
            await client.query(`
                UPDATE hotel_reservations 
                SET reservation_date = DATE(created_at)
                WHERE reservation_date IS NULL
            `);
            
            console.log('✅ 기존 데이터의 reservation_date 업데이트 완료 (created_at 기준)');
        }
        
        // 4. 인덱스 생성
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_hotel_res_reservation_date 
            ON hotel_reservations(reservation_date)
        `);
        console.log('✅ reservation_date 인덱스 생성 완료');
        
        // 5. 현재 테이블 구조 확인
        console.log('\n📊 hotel_reservations 테이블 구조 확인:');
        const structure = await client.query(`
            SELECT column_name, data_type, column_default, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'hotel_reservations' 
            AND column_name IN ('reservation_number', 'reservation_date', 'check_in_date', 'created_at', 'status')
            ORDER BY ordinal_position
        `);
        
        structure.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type} (기본값: ${col.column_default || 'None'}, NULL: ${col.is_nullable})`);
        });
        
        await client.query('COMMIT');
        
        console.log('\n✅ reservation_date 컬럼 추가 완료!');
        console.log('📝 용도: 인박스에서 예약을 등록한 날짜 (수배관리까지 유지됨)');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 컬럼 추가 실패:', error);
        console.error('   오류 상세:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
addReservationDateColumn()
    .then(() => {
        console.log('\n🎉 모든 작업 완료!');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ 치명적 오류:', error);
        process.exit(1);
    });
