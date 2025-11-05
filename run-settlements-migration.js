const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// 환경변수에서 데이터베이스 URL 가져오기
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error('❌ DATABASE_URL 환경변수가 설정되지 않았습니다.');
    console.log('💡 .env 파일에 DATABASE_URL을 설정하거나 환경변수로 지정해주세요.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function runMigration() {
    try {
        console.log('🚀 정산관리 테이블 마이그레이션 시작...\n');
        
        // SQL 파일 읽기
        const sqlPath = path.join(__dirname, 'migrations', 'create-settlements-table.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        console.log('📄 SQL 파일 읽기 완료:', sqlPath);
        
        // SQL 실행
        await pool.query(sql);
        
        console.log('✅ settlements 테이블 생성 완료\n');
        
        // 생성된 테이블 확인
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'settlements'
            ORDER BY ordinal_position
        `);
        
        console.log('📋 생성된 컬럼 목록:');
        console.table(result.rows);
        
        // 인덱스 확인
        const indexResult = await pool.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'settlements'
        `);
        
        console.log('\n📋 생성된 인덱스 목록:');
        console.table(indexResult.rows);
        
        console.log('\n✅ 마이그레이션 완료!');
        console.log('💡 이제 정산이관 기능을 사용할 수 있습니다.');
        
    } catch (error) {
        console.error('❌ 마이그레이션 실패:', error.message);
        console.error('상세 오류:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
