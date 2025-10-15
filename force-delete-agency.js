const { Pool } = require('pg');

// 데이터베이스 연결
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function forceDeleteAgency(agencyName) {
  console.log(`🚀 "${agencyName}" 업체 강제 삭제 시작...\n`);
  
  try {
    // 1. 업체 정보 확인
    const agencyResult = await pool.query(
      `SELECT id, agency_name, is_active FROM pickup_agencies WHERE agency_name = $1`,
      [agencyName]
    );
    
    if (agencyResult.rows.length === 0) {
      console.log(`❌ "${agencyName}" 업체를 찾을 수 없습니다.\n`);
      return;
    }
    
    const agency = agencyResult.rows[0];
    console.log(`📋 업체 정보:`);
    console.log(`  - ID: ${agency.id}`);
    console.log(`  - 이름: ${agency.agency_name}`);
    console.log(`  - 상태: ${agency.is_active ? '활성' : '비활성'}\n`);
    
    // 2. 연결된 픽업건 확인
    const pickupsResult = await pool.query(
      `SELECT status, COUNT(*) as count 
       FROM airport_pickups 
       WHERE agency_id = $1 
       GROUP BY status`,
      [agency.id]
    );
    
    if (pickupsResult.rows.length > 0) {
      console.log(`🔗 연결된 픽업건:`);
      pickupsResult.rows.forEach(row => {
        console.log(`  - ${row.status}: ${row.count}건`);
      });
      console.log('');
      
      // 3. 픽업건의 agency_id를 NULL로 설정
      const updateResult = await pool.query(
        `UPDATE airport_pickups SET agency_id = NULL WHERE agency_id = $1`,
        [agency.id]
      );
      
      console.log(`✅ ${updateResult.rowCount}건의 픽업 예약에서 업체 연결을 해제했습니다.\n`);
    } else {
      console.log(`✅ 연결된 픽업건이 없습니다.\n`);
    }
    
    // 4. 업체 완전 삭제
    await pool.query(`DELETE FROM pickup_agencies WHERE id = $1`, [agency.id]);
    
    console.log(`🎉 "${agencyName}" 업체가 완전히 삭제되었습니다!\n`);
    
    // 5. 확인
    const checkResult = await pool.query(
      `SELECT COUNT(*) FROM pickup_agencies WHERE agency_name = $1`,
      [agencyName]
    );
    
    if (checkResult.rows[0].count === '0') {
      console.log(`✅ 삭제 확인 완료\n`);
    }
    
  } catch (error) {
    console.error('\n❌ 삭제 실패:', error.message);
    console.error('\n에러 상세:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 명령줄 인자로 업체명 받기
const agencyName = process.argv[2];

if (!agencyName) {
  console.log('❌ 사용법: node force-delete-agency.js "업체명"\n');
  console.log('예시: node force-delete-agency.js "투어비스"\n');
  process.exit(1);
}

// 실행
forceDeleteAgency(agencyName);
