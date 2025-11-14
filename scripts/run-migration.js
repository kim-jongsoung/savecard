/**
 * 데이터베이스 마이그레이션 실행 스크립트
 * 특정 마이그레이션 파일을 실행합니다.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// 환경변수 로드
if (fs.existsSync('./railsql.env')) {
    require('dotenv').config({ path: './railsql.env' });
} else {
    require('dotenv').config();
}

async function runMigration(filename) {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });
    
    try {
        const migrationPath = path.join(__dirname, '../migrations', filename);
        
        if (!fs.existsSync(migrationPath)) {
            console.error(`❌ 마이그레이션 파일을 찾을 수 없습니다: ${filename}`);
            process.exit(1);
        }
        
        const sql = fs.readFileSync(migrationPath, 'utf8');
        
        console.log(`🚀 마이그레이션 실행 중: ${filename}`);
        await pool.query(sql);
        console.log(`✅ 마이그레이션 완료: ${filename}`);
        
    } catch (error) {
        console.error(`❌ 마이그레이션 실패:`, error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// 명령줄 인수로 파일명 받기
const filename = process.argv[2] || '006_create_season_tables.sql';
runMigration(filename);
