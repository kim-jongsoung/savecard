/**
 * 서버 시작 시 자동 마이그레이션
 * 테이블이 없으면 자동으로 생성
 */

const fs = require('fs');
const path = require('path');

async function autoMigrate(pool) {
    try {
        // season_types 테이블 존재 확인
        const checkTable = await pool.query(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'season_types'
            )`
        );
        
        if (!checkTable.rows[0].exists) {
            console.log('🔧 시즌 테이블이 없습니다. 마이그레이션을 실행합니다...');
            
            const migrationPath = path.join(__dirname, '../migrations/006_create_season_tables.sql');
            const sql = fs.readFileSync(migrationPath, 'utf8');
            
            await pool.query(sql);
            console.log('✅ 시즌 관리 테이블 생성 완료!');
        } else {
            console.log('✅ 시즌 테이블이 이미 존재합니다.');
        }
    } catch (error) {
        console.error('❌ 자동 마이그레이션 실패:', error.message);
        // 에러가 나도 서버는 계속 실행
    }
}

module.exports = { autoMigrate };
