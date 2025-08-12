const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkTables() {
  try {
    console.log('📋 현재 테이블 확인 중...');
    
    const result = await pool.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    
    const tables = {};
    result.rows.forEach(row => {
      if (!tables[row.table_name]) {
        tables[row.table_name] = [];
      }
      tables[row.table_name].push(`${row.column_name} (${row.data_type})`);
    });
    
    console.log('🗂️ 현재 테이블 구조:');
    Object.keys(tables).forEach(tableName => {
      console.log(`\n📊 ${tableName}:`);
      tables[tableName].forEach(column => {
        console.log(`   - ${column}`);
      });
    });
    
    // 필요한 테이블들 확인
    const requiredTables = ['users', 'agencies', 'stores', 'usages', 'banners', 'partner_applications'];
    const existingTables = Object.keys(tables);
    
    console.log('\n✅ 필요한 테이블 확인:');
    requiredTables.forEach(table => {
      const exists = existingTables.includes(table);
      console.log(`   ${exists ? '✅' : '❌'} ${table}`);
    });
    
  } catch (error) {
    console.error('❌ 테이블 확인 오류:', error);
  } finally {
    await pool.end();
  }
}

checkTables();
