require('dotenv').config({ path: './railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function migratePickupColumns() {
  try {
    console.log('🔧 픽업 테이블 마이그레이션 시작...');
    console.log('DATABASE_URL:', process.env.DATABASE_URL?.substring(0, 30) + '...');
    
    // 1. 테이블 존재 확인
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'airport_pickups'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('❌ airport_pickups 테이블이 존재하지 않습니다.');
      return;
    }
    
    console.log('✅ airport_pickups 테이블 확인');
    
    // 2. 컬럼 존재 확인 및 추가
    const columns = [
      { name: 'record_type', type: 'VARCHAR(20)', default: "'arrival'" },
      { name: 'display_date', type: 'DATE', default: 'NULL' },
      { name: 'display_time', type: 'TIME', default: 'NULL' },
      { name: 'departure_date', type: 'DATE', default: 'NULL' },
      { name: 'departure_time', type: 'TIME', default: 'NULL' },
      { name: 'departure_airport', type: 'VARCHAR(10)', default: 'NULL' },
      { name: 'arrival_date', type: 'DATE', default: 'NULL' },
      { name: 'arrival_time', type: 'TIME', default: 'NULL' },
      { name: 'arrival_airport', type: 'VARCHAR(10)', default: 'NULL' },
      { name: 'linked_id', type: 'INTEGER', default: 'NULL' },
      { name: 'flight_number', type: 'VARCHAR(20)', default: 'NULL' }
    ];
    
    for (const col of columns) {
      const colCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'airport_pickups' AND column_name = $1
        );
      `, [col.name]);
      
      if (!colCheck.rows[0].exists) {
        await pool.query(`
          ALTER TABLE airport_pickups 
          ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default};
        `);
        console.log(`✅ ${col.name} 컬럼 추가 완료`);
      } else {
        console.log(`⏭️  ${col.name} 컬럼 이미 존재`);
      }
    }
    
    // 3. 인덱스 추가
    const indexes = [
      { name: 'idx_display_date', column: 'display_date' },
      { name: 'idx_record_type', column: 'record_type' },
      { name: 'idx_linked_id', column: 'linked_id' },
      { name: 'idx_flight_number', column: 'flight_number' }
    ];
    
    for (const idx of indexes) {
      try {
        await pool.query(`
          CREATE INDEX IF NOT EXISTS ${idx.name} ON airport_pickups(${idx.column});
        `);
        console.log(`✅ ${idx.name} 인덱스 추가 완료`);
      } catch (err) {
        console.log(`⏭️  ${idx.name} 인덱스 이미 존재 또는 오류:`, err.message);
      }
    }
    
    console.log('\n🎉 마이그레이션 완료!');
    console.log('📝 추가된 컬럼: record_type, display_date, display_time, departure_date, departure_time, departure_airport, arrival_date, arrival_time, arrival_airport, linked_id, flight_number');
    
  } catch (error) {
    console.error('❌ 마이그레이션 실패:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// 실행
migratePickupColumns().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
