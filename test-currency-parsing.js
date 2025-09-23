const { parseBooking } = require('./utils/aiParser');

// NOL 테스트 데이터 (사용자가 제공한 실제 데이터)
const nolTestData = `
NOL 에 데이터는 드레스덴 & 작센스위스 1일투어 프라하출발 예약접수 
예약 일시 2025-09-23 06:38:35 
예약 번호 463172 
예약 확인 번호 PROD:a5bd78 
예약 채널 NOL 인터파크 
2025-09-23 06:38:35 예약접수 
예약한 상품 드레스덴 & 작센스위스 1일투어 프라하출발 
총 수량 4₩284,000 
드레스덴&작센스위스 1일투어 
이용예정일 2025-10-21 
성인 4 
이용예정일 변경예약 아이템 상세 보기 판매 금액 상세 보기
`;

// 달러 테스트 데이터
const usdTestData = `
VASCO 괌 정글리버크루즈 원주민문화체험 맹글로브숲 수공예품만들기 물소타기
예약번호: 459447
확인번호: PROD:d7cb49
총 금액: $304.00
성인 2명 x $101.33
아동 1명 x $101.33
이용일: 2025-10-09
`;

async function testCurrencyParsing() {
    console.log('🧪 금액 단위 자동 판별 테스트 시작...\n');
    
    try {
        // NOL 데이터 테스트 (원화 - 1000 이상)
        console.log('📋 NOL 데이터 파싱 테스트 (원화 예상):');
        console.log('입력:', nolTestData.substring(0, 100) + '...');
        
        const nolResult = await parseBooking(nolTestData);
        console.log('\n✅ NOL 파싱 결과:');
        console.log('- 총 금액:', nolResult.total_amount);
        console.log('- 성인 단가:', nolResult.adult_unit_price);
        console.log('- 통화 정보:', nolResult.currency_info);
        console.log('- 총 금액 표시:', nolResult.total_amount_display);
        console.log('- 성인 단가 표시:', nolResult.adult_unit_price_display);
        console.log('- 패키지 타입:', nolResult.package_type);
        console.log('- 플랫폼:', nolResult.platform_name);
        
        console.log('\n' + '='.repeat(50) + '\n');
        
        // USD 데이터 테스트 (달러 - 999 이하)
        console.log('📋 VASCO 데이터 파싱 테스트 (달러 예상):');
        console.log('입력:', usdTestData.substring(0, 100) + '...');
        
        const usdResult = await parseBooking(usdTestData);
        console.log('\n✅ VASCO 파싱 결과:');
        console.log('- 총 금액:', usdResult.total_amount);
        console.log('- 성인 단가:', usdResult.adult_unit_price);
        console.log('- 통화 정보:', usdResult.currency_info);
        console.log('- 총 금액 표시:', usdResult.total_amount_display);
        console.log('- 성인 단가 표시:', usdResult.adult_unit_price_display);
        console.log('- 패키지 타입:', usdResult.package_type);
        console.log('- 플랫폼:', usdResult.platform_name);
        
        console.log('\n🎯 테스트 결과 요약:');
        console.log('- NOL (원화):', nolResult.total_amount >= 1000 ? '✅ 정확' : '❌ 오류');
        console.log('- VASCO (달러):', usdResult.total_amount <= 999 ? '✅ 정확' : '❌ 오류');
        
    } catch (error) {
        console.error('❌ 테스트 실패:', error.message);
    }
}

// 테스트 실행
if (require.main === module) {
    testCurrencyParsing();
}

module.exports = { testCurrencyParsing };
