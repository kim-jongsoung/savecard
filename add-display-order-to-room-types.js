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

async function addDisplayOrderColumn() {
    try {
        console.log('📊 room_types 테이블에 display_order 컬럼 추가 시작...');
        
        // display_order 컬럼 추가
        await pool.query(`
            ALTER TABLE room_types 
            ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 999;
        `);
        console.log('✅ display_order 컬럼 추가 완료');
        
        // 기존 데이터에 순차적 순위 부여 (호텔별, 코드 순)
        await pool.query(`
            WITH ranked AS (
                SELECT id, 
                       ROW_NUMBER() OVER (PARTITION BY hotel_id ORDER BY room_type_code) as rn
                FROM room_types
            )
            UPDATE room_types rt
            SET display_order = r.rn * 10
            FROM ranked r
            WHERE rt.id = r.id;
        `);
        console.log('✅ 기존 데이터에 순위 부여 완료 (10, 20, 30, ...)');
        
        // 인덱스 생성
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_room_types_display_order 
            ON room_types(hotel_id, display_order, is_active);
        `);
        console.log('✅ 인덱스 생성 완료');
        
        console.log('');
        console.log('🎉 display_order 컬럼 추가 완료!');
        console.log('');
        console.log('📋 사용법:');
        console.log('  - display_order 값이 작을수록 먼저 표시됩니다');
        console.log('  - 기본값: 999 (제일 뒤에 표시)');
        console.log('  - 권장: 10, 20, 30... 간격으로 설정 (중간 삽입 용이)');
        
    } catch (error) {
        console.error('❌ 컬럼 추가 실패:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

addDisplayOrderColumn();
