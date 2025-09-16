// 예약 테이블 스키마 수정 스크립트
// 파싱 데이터와 데이터베이스 컬럼 매핑 문제 해결

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixReservationsSchema() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 예약 테이블 스키마 수정 시작...');
    
    // 1. 현재 테이블 구조 확인
    console.log('📋 현재 테이블 구조 확인 중...');
    const tableInfo = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'reservations' 
      ORDER BY ordinal_position
    `);
    
    console.log('현재 컬럼들:', tableInfo.rows.map(row => row.column_name));
    
    // 2. 누락된 컬럼들 추가
    const columnsToAdd = [
      { name: 'platform_name', type: 'VARCHAR(50)', default: "'NOL'" },
      { name: 'channel', type: 'VARCHAR(50)', default: "'웹'" },
      { name: 'english_first_name', type: 'VARCHAR(100)', default: 'NULL' },
      { name: 'english_last_name', type: 'VARCHAR(100)', default: 'NULL' },
      { name: 'people_adult', type: 'INTEGER', default: '1' },
      { name: 'people_child', type: 'INTEGER', default: '0' },
      { name: 'people_infant', type: 'INTEGER', default: '0' },
      { name: 'total_amount', type: 'DECIMAL(12,2)', default: 'NULL' },
      { name: 'adult_unit_price', type: 'DECIMAL(10,2)', default: '0' },
      { name: 'child_unit_price', type: 'DECIMAL(10,2)', default: '0' },
      { name: 'payment_status', type: 'VARCHAR(20)', default: "'대기'" }
    ];
    
    const existingColumns = tableInfo.rows.map(row => row.column_name);
    
    for (const column of columnsToAdd) {
      if (!existingColumns.includes(column.name)) {
        console.log(`➕ ${column.name} 컬럼 추가 중...`);
        try {
          await client.query(`
            ALTER TABLE reservations 
            ADD COLUMN ${column.name} ${column.type} DEFAULT ${column.default}
          `);
          console.log(`✅ ${column.name} 컬럼 추가 완료`);
        } catch (error) {
          console.log(`⚠️ ${column.name} 컬럼 추가 실패:`, error.message);
        }
      } else {
        console.log(`✓ ${column.name} 컬럼 이미 존재`);
      }
    }
    
    // 3. 기존 데이터 마이그레이션
    console.log('🔄 기존 데이터 마이그레이션 중...');
    
    // company -> platform_name 데이터 이동
    if (existingColumns.includes('company') && existingColumns.includes('platform_name')) {
      await client.query(`
        UPDATE reservations 
        SET platform_name = COALESCE(company, 'NOL') 
        WHERE platform_name IS NULL OR platform_name = ''
      `);
      console.log('✅ company -> platform_name 데이터 이동 완료');
    }
    
    // english_name -> english_first_name, english_last_name 분리
    if (existingColumns.includes('english_name')) {
      await client.query(`
        UPDATE reservations 
        SET 
          english_first_name = CASE 
            WHEN english_name IS NOT NULL AND english_name != '' 
            THEN SPLIT_PART(english_name, ' ', 1) 
            ELSE NULL 
          END,
          english_last_name = CASE 
            WHEN english_name IS NOT NULL AND english_name != '' AND ARRAY_LENGTH(STRING_TO_ARRAY(english_name, ' '), 1) > 1
            THEN SUBSTRING(english_name FROM POSITION(' ' IN english_name) + 1)
            ELSE NULL 
          END
        WHERE (english_first_name IS NULL OR english_last_name IS NULL) 
        AND english_name IS NOT NULL AND english_name != ''
      `);
      console.log('✅ english_name 분리 완료');
    }
    
    // amount -> total_amount 데이터 이동
    if (existingColumns.includes('amount')) {
      await client.query(`
        UPDATE reservations 
        SET total_amount = amount 
        WHERE total_amount IS NULL AND amount IS NOT NULL
      `);
      console.log('✅ amount -> total_amount 데이터 이동 완료');
    }
    
    // 4. 최종 테이블 구조 확인
    console.log('📋 수정된 테이블 구조 확인...');
    const updatedTableInfo = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'reservations' 
      ORDER BY ordinal_position
    `);
    
    console.log('수정된 컬럼들:');
    updatedTableInfo.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    console.log('✅ 예약 테이블 스키마 수정 완료!');
    
  } catch (error) {
    console.error('❌ 스키마 수정 실패:', error);
    throw error;
  } finally {
    client.release();
  }
}

// 스크립트 실행
if (require.main === module) {
  fixReservationsSchema()
    .then(() => {
      console.log('🎉 스키마 수정 작업 완료');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 스키마 수정 실패:', error);
      process.exit(1);
    });
}

module.exports = { fixReservationsSchema };
