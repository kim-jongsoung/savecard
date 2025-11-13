const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다');
    require('dotenv').config({ path: './railsql.env' });
} else {
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addInventoryType() {
    const client = await pool.connect();
    
    try {
        console.log('🏨 호텔 테이블에 재고 관리 방식 컬럼 추가...\n');
        
        // hotels 테이블에 inventory_type 추가
        await client.query(`
            ALTER TABLE hotels 
            ADD COLUMN IF NOT EXISTS inventory_type VARCHAR(20) DEFAULT 'count'
        `);
        console.log('✅ inventory_type 컬럼 추가 완료');
        console.log('   - count: 객실 수 카운팅 (기본값)');
        console.log('   - status: O/X 상태 방식');
        
        // 기본값 확인
        const result = await client.query('SELECT COUNT(*) FROM hotels');
        console.log(`\n📊 현재 ${result.rows[0].count}개 호텔이 'count' 방식으로 설정됨\n`);
        
    } catch (error) {
        console.error('❌ 오류:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
if (require.main === module) {
    addInventoryType()
        .then(() => {
            console.log('✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { addInventoryType };
