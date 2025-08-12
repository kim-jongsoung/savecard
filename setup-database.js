const { testConnection, createTables, migrateFromJSON } = require('./database');

async function setupDatabase() {
  console.log('🚀 데이터베이스 설정을 시작합니다...\n');
  
  // 1. 연결 테스트
  console.log('1️⃣ 데이터베이스 연결 테스트...');
  const connected = await testConnection();
  if (!connected) {
    console.log('❌ 데이터베이스 연결에 실패했습니다. .env 파일의 DATABASE_URL을 확인해주세요.');
    return;
  }
  
  // 2. 테이블 생성
  console.log('\n2️⃣ 테이블 생성 중...');
  try {
    await createTables();
  } catch (err) {
    console.error('❌ 테이블 생성 실패:', err.message);
    return;
  }
  
  // 3. 기존 JSON 데이터 마이그레이션
  console.log('\n3️⃣ 기존 데이터 마이그레이션 중...');
  try {
    await migrateFromJSON();
  } catch (err) {
    console.error('⚠️ 데이터 마이그레이션 중 일부 오류:', err.message);
  }
  
  console.log('\n✅ 데이터베이스 설정이 완료되었습니다!');
  console.log('이제 Railway Data 탭에서 생성된 테이블들을 확인할 수 있습니다.');
  
  process.exit(0);
}

setupDatabase().catch(err => {
  console.error('❌ 설정 중 오류 발생:', err);
  process.exit(1);
});
