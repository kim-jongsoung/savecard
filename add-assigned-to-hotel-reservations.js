const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다 (로컬 Railway 연동)');
    require('dotenv').config({ path: './railsql.env' });
} else {
    console.log('🔧 기본 .env 파일을 사용합니다');
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway.app') ? { rejectUnauthorized: false } : false
});

async function addAssignedToColumn() {
    try {
        console.log('📊 hotel_reservations 테이블에 assigned_to 컬럼 추가 시작...');
        
        // assigned_to 컬럼 추가
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'hotel_reservations' AND column_name = 'assigned_to'
                ) THEN
                    ALTER TABLE hotel_reservations ADD COLUMN assigned_to VARCHAR(100);
                END IF;
            END $$;
        `);
        console.log('✅ assigned_to 컬럼 추가 완료');
        
        // 인덱스 생성
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_hotel_res_assigned_to 
            ON hotel_reservations(assigned_to);
        `);
        console.log('✅ 인덱스 생성 완료');
        
        console.log('');
        console.log('🎉 assigned_to 컬럼 추가 완료!');
        console.log('');
        console.log('📋 사용법:');
        console.log('  - 호텔 인박스에서 파싱 후 저장 시 담당자 이름이 자동으로 저장됩니다');
        console.log('  - 수배관리 페이지에서 담당자별 검색이 가능합니다');
        
    } catch (error) {
        console.error('❌ 컬럼 추가 실패:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

addAssignedToColumn();
