const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function autoSetup() {
  console.log('🚀 괌세이브카드 PostgreSQL 자동 설정\n');
  
  // 1. DATABASE_URL 입력받기
  const databaseUrl = await new Promise((resolve) => {
    rl.question('Railway Variables 탭에서 복사한 DATABASE_URL을 붙여넣으세요:\n', (answer) => {
      resolve(answer.trim());
    });
  });
  
  if (!databaseUrl || !databaseUrl.startsWith('postgresql://')) {
    console.log('❌ 올바른 DATABASE_URL이 아닙니다. postgresql://로 시작해야 합니다.');
    rl.close();
    return;
  }
  
  console.log('\n✅ DATABASE_URL 확인됨');
  
  // 2. .env 파일 업데이트
  console.log('📝 .env 파일 업데이트 중...');
  const envPath = path.join(__dirname, '.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  
  // DATABASE_URL 라인 찾아서 교체
  envContent = envContent.replace(
    /DATABASE_URL=.*/,
    `DATABASE_URL=${databaseUrl}`
  );
  
  fs.writeFileSync(envPath, envContent);
  console.log('✅ .env 파일 업데이트 완료');
  
  // 3. 패키지 설치 확인
  console.log('\n📦 필요한 패키지 설치 확인 중...');
  const packageJsonPath = path.join(__dirname, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  if (!packageJson.dependencies || !packageJson.dependencies.pg) {
    console.log('⚠️ pg 패키지가 설치되지 않았습니다.');
    console.log('터미널에서 다음 명령어를 실행해주세요:');
    console.log('npm install pg dotenv');
    rl.close();
    return;
  }
  
  console.log('✅ 필요한 패키지가 설치되어 있습니다.');
  
  // 4. 데이터베이스 연결 및 설정
  console.log('\n🔗 데이터베이스 연결 테스트 중...');
  
  try {
    // 환경변수 다시 로드
    delete require.cache[require.resolve('dotenv')];
    require('dotenv').config();
    
    const { testConnection, createTables, migrateFromJSON } = require('./database');
    
    // 연결 테스트
    const connected = await testConnection();
    if (!connected) {
      console.log('❌ 데이터베이스 연결 실패');
      rl.close();
      return;
    }
    
    // 테이블 생성
    console.log('🏗️ 테이블 생성 중...');
    await createTables();
    
    // 데이터 마이그레이션
    console.log('📊 기존 데이터 마이그레이션 중...');
    await migrateFromJSON();
    
    console.log('\n🎉 모든 설정이 완료되었습니다!');
    console.log('Railway Data 탭에서 생성된 테이블들을 확인할 수 있습니다.');
    console.log('\n생성된 테이블:');
    console.log('- stores (제휴업체)');
    console.log('- partner_applications (제휴업체 신청)');
    console.log('- cards (카드 발급)');
    console.log('- banners (배너)');
    
  } catch (err) {
    console.error('❌ 설정 중 오류 발생:', err.message);
  }
  
  rl.close();
}

autoSetup().catch(err => {
  console.error('❌ 자동 설정 실패:', err);
  rl.close();
});
