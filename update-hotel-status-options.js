require('dotenv').config();
require('dotenv').config({ path: 'railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function updateHotelStatusOptions() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 hotel_reservations.status 컬럼 업데이트 시작...');
        
        await client.query('BEGIN');
        
        // 1. 기존 CHECK 제약조건 삭제
        console.log('1️⃣ 기존 status CHECK 제약조건 제거 중...');
        
        const constraints = await client.query(`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'hotel_reservations' 
            AND constraint_type = 'CHECK'
            AND constraint_name LIKE '%status%'
        `);
        
        for (const row of constraints.rows) {
            await client.query(`
                ALTER TABLE hotel_reservations 
                DROP CONSTRAINT IF EXISTS ${row.constraint_name}
            `);
            console.log(`   ✅ ${row.constraint_name} 제거 완료`);
        }
        
        // 2. 새로운 CHECK 제약조건 추가
        console.log('2️⃣ 새로운 status CHECK 제약조건 추가 중...');
        
        await client.query(`
            ALTER TABLE hotel_reservations 
            ADD CONSTRAINT hotel_reservations_status_check 
            CHECK (status IN ('pending', 'processing', 'confirmed', 'cancelled', 'modifying', 'completed'))
        `);
        console.log('   ✅ 새로운 제약조건 추가 완료');
        
        // 3. 기존 데이터 마이그레이션 (필요시)
        console.log('3️⃣ 기존 데이터 확인 중...');
        
        const statusCounts = await client.query(`
            SELECT status, COUNT(*) as count 
            FROM hotel_reservations 
            GROUP BY status
        `);
        
        console.log('   현재 status 분포:');
        statusCounts.rows.forEach(row => {
            console.log(`   - ${row.status}: ${row.count}건`);
        });
        
        await client.query('COMMIT');
        
        console.log('\n✅ hotel_reservations.status 업데이트 완료!');
        console.log('📋 사용 가능한 상태:');
        console.log('   - pending: 대기중');
        console.log('   - processing: 수배중');
        console.log('   - confirmed: 확정');
        console.log('   - cancelled: 예약취소');
        console.log('   - modifying: 수정중(예약변경)');
        console.log('   - completed: 완료');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 업데이트 실패:', error);
        console.error('   오류 상세:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
updateHotelStatusOptions()
    .then(() => {
        console.log('\n🎉 모든 작업 완료!');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ 치명적 오류:', error);
        process.exit(1);
    });
