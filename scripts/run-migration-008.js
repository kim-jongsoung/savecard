/**
 * 프로모션 시스템 재설계 마이그레이션 수동 실행
 * Railway에서 마이그레이션이 자동 실행되지 않을 때 사용
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔧 프로모션 시스템 재설계 마이그레이션 시작...');
    
    // SQL 파일 읽기
    const migrationFile = path.join(__dirname, '../migrations/008_recreate_promotions_simple.sql');
    const sql = fs.readFileSync(migrationFile, 'utf8');
    
    console.log('📄 SQL 파일 로드 완료');
    console.log('📊 SQL 길이:', sql.length, 'bytes');
    
    // 실행
    await pool.query(sql);
    
    console.log('✅ 마이그레이션 완료!');
    
    // 테이블 확인
    const checkTables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('promotions', 'promotion_daily_rates', 'promotion_benefits')
      ORDER BY table_name
    `);
    
    console.log('\n생성된 테이블:');
    checkTables.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });
    
  } catch (error) {
    console.error('❌ 마이그레이션 실패:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

runMigration();
