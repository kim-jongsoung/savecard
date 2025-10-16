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
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function addConfirmationStatus() {
    try {
        console.log('🔧 신규예약 확정 상태 시스템 추가 시작...\n');
        
        // 1. confirmation_status 컬럼 추가
        console.log('1️⃣ confirmation_status 컬럼 추가...');
        await pool.query(`
            ALTER TABLE airport_pickups 
            ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(20) DEFAULT 'pending'
        `);
        console.log('✅ 컬럼 추가 완료');
        
        // 2. 기존 데이터는 모두 confirmed로 처리 (이미 달력에 있는 예약들)
        console.log('\n2️⃣ 기존 예약 confirmed로 처리...');
        const result = await pool.query(`
            UPDATE airport_pickups 
            SET confirmation_status = 'confirmed'
            WHERE confirmation_status = 'pending'
        `);
        console.log(`✅ ${result.rowCount}개 예약을 confirmed로 처리`);
        
        // 3. 인덱스 추가 (성능 최적화)
        console.log('\n3️⃣ 인덱스 추가...');
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_confirmation_status 
            ON airport_pickups(confirmation_status)
        `);
        console.log('✅ 인덱스 추가 완료');
        
        // 4. 결과 확인
        console.log('\n4️⃣ 상태별 예약 현황:');
        const stats = await pool.query(`
            SELECT 
                confirmation_status,
                COUNT(*) as count
            FROM airport_pickups
            WHERE status = 'active'
            GROUP BY confirmation_status
            ORDER BY confirmation_status
        `);
        
        console.table(stats.rows);
        
        console.log('\n✅ 신규예약 확정 상태 시스템 추가 완료!');
        console.log('\n상태 설명:');
        console.log('- pending: 신규 접수 (검수 대기)');
        console.log('- confirmed: 확정 (달력 표시)');
        console.log('- rejected: 미확정 (보류/삭제 대상)');
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
        console.error(error);
    } finally {
        await pool.end();
    }
}

addConfirmationStatus();
