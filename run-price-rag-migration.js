// 요금 RAG 문서 테이블 마이그레이션 스크립트
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function runMigration() {
    try {
        console.log('🚀 요금 RAG 테이블 마이그레이션 시작...\n');
        
        // SQL 파일 읽기
        const sqlPath = path.join(__dirname, 'migrations', 'create-price-rag-table.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        console.log('📄 SQL 파일 읽기 완료');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        // 마이그레이션 실행
        await pool.query(sql);
        
        console.log('✅ 테이블 생성 완료: price_rag_documents');
        console.log('✅ 인덱스 생성 완료');
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎉 마이그레이션 완료!\n');
        
        // 테이블 확인
        const checkResult = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'price_rag_documents'
            ORDER BY ordinal_position
        `);
        
        console.log('📋 생성된 컬럼 목록:');
        checkResult.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type}`);
        });
        
    } catch (error) {
        console.error('❌ 마이그레이션 실패:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
