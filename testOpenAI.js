const { parseBooking } = require('./utils/aiParser');
require('dotenv').config();

// 테스트용 예약 텍스트 예시들
const testCases = [
    {
        name: "NOL 인터파크 예약",
        rawText: `
[NOL] 괌 돌핀 워칭 투어
예약번호: IP20241201001
확인번호: NOL-GU-2024-1201
상품명: 괌 돌핀 워칭 & 스노클링 투어
이용일: 2024년 12월 15일
출발시간: 09:00
총 금액: 150,000원 (성인 2명)
성인: 2명
소아: 0명

예약자 정보:
한글명: 김철수
영문명: KIM CHULSOO
전화번호: 010-1234-5678
이메일: chulsoo@example.com
카카오톡: chulsoo_kim

특이사항: 호텔 픽업 요청
        `
    },
    {
        name: "KLOOK 예약",
        rawText: `
Klook Booking Confirmation
Booking Reference: KL-789456123
Product: Guam Underwater World Aquarium Ticket
Date: December 20, 2024
Time: 10:30 AM
Quantity: 3 tickets
Total Amount: $45.00

Customer Information:
Name: PARK YOUNGHEE
Korean Name: 박영희
Email: younghee.park@gmail.com
Phone: +82-10-9876-5432

Adult: 2 tickets ($18 each)
Child: 1 ticket ($9)
        `
    },
    {
        name: "간단한 예약 정보",
        rawText: `
예약번호: GU2024120001
상품: 괌 시내 관광
날짜: 2024-12-25
이름: 이민수
전화: 010-5555-1234
인원: 4명 (성인 3, 소아 1)
금액: $120
        `
    }
];

async function runTests() {
    console.log('🧪 OpenAI 파싱 테스트 시작\n');
    
    // OpenAI API 키 확인
    if (!process.env.OPENAI_API_KEY) {
        console.error('❌ OPENAI_API_KEY 환경변수가 설정되지 않았습니다');
        process.exit(1);
    }
    
    console.log('🔑 OpenAI API 키 확인됨');
    console.log('=' .repeat(80));
    
    for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        
        console.log(`\n📋 테스트 ${i + 1}: ${testCase.name}`);
        console.log('-'.repeat(50));
        
        try {
            console.log('📝 원본 텍스트:');
            console.log(testCase.rawText.trim());
            console.log('\n🤖 OpenAI 파싱 중...');
            
            const startTime = Date.now();
            const result = await parseBooking(testCase.rawText);
            const endTime = Date.now();
            
            console.log(`⏱️ 파싱 시간: ${endTime - startTime}ms`);
            console.log('\n✅ 파싱 결과:');
            console.log(JSON.stringify(result, null, 2));
            
            // 주요 필드 검증
            console.log('\n🔍 주요 필드 검증:');
            console.log(`- 예약번호: ${result.reservation_number || '❌ 없음'}`);
            console.log(`- 플랫폼: ${result.platform_name || '❌ 없음'}`);
            console.log(`- 상품명: ${result.product_name || '❌ 없음'}`);
            console.log(`- 한글이름: ${result.korean_name || '❌ 없음'}`);
            console.log(`- 영문이름: ${result.english_first_name || '❌ 없음'} ${result.english_last_name || ''}`);
            console.log(`- 이용일: ${result.usage_date || '❌ 없음'}`);
            console.log(`- 이용시간: ${result.usage_time || '❌ 없음'}`);
            console.log(`- 총금액: $${result.total_amount || '❌ 없음'}`);
            console.log(`- 총인원: ${result.guest_count || '❌ 없음'}명 (성인: ${result.people_adult}, 소아: ${result.people_child})`);
            console.log(`- 연락처: ${result.phone || '❌ 없음'}`);
            console.log(`- 이메일: ${result.email || '❌ 없음'}`);
            
        } catch (error) {
            console.error('❌ 파싱 실패:', error.message);
            console.error('상세 오류:', error);
        }
        
        console.log('\n' + '='.repeat(80));
    }
    
    console.log('\n🎉 모든 테스트 완료!');
}

// 개별 테스트 실행 함수
async function testSingleCase(caseIndex = 0) {
    if (caseIndex >= testCases.length) {
        console.error(`❌ 잘못된 테스트 케이스 인덱스: ${caseIndex}`);
        return;
    }
    
    const testCase = testCases[caseIndex];
    console.log(`🧪 단일 테스트: ${testCase.name}\n`);
    
    try {
        const result = await parseBooking(testCase.rawText);
        console.log('✅ 파싱 결과:');
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('❌ 파싱 실패:', error.message);
    }
}

// 커스텀 텍스트 테스트 함수
async function testCustomText(customText) {
    console.log('🧪 커스텀 텍스트 테스트\n');
    
    try {
        const result = await parseBooking(customText);
        console.log('✅ 파싱 결과:');
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('❌ 파싱 실패:', error.message);
    }
}

// 명령행 인수 처리
const args = process.argv.slice(2);

if (args.length === 0) {
    // 기본: 모든 테스트 실행
    runTests();
} else if (args[0] === 'single') {
    // 단일 테스트 실행
    const caseIndex = parseInt(args[1]) || 0;
    testSingleCase(caseIndex);
} else if (args[0] === 'custom') {
    // 커스텀 텍스트 테스트
    const customText = args.slice(1).join(' ');
    if (customText) {
        testCustomText(customText);
    } else {
        console.error('❌ 커스텀 텍스트를 입력해주세요');
        console.log('사용법: node testOpenAI.js custom "여기에 예약 텍스트 입력"');
    }
} else {
    console.log('📖 사용법:');
    console.log('  node testOpenAI.js                    # 모든 테스트 실행');
    console.log('  node testOpenAI.js single [인덱스]     # 특정 테스트만 실행 (0, 1, 2)');
    console.log('  node testOpenAI.js custom "텍스트"     # 커스텀 텍스트 테스트');
}

// 에러 처리
process.on('unhandledRejection', (error) => {
    console.error('🚨 처리되지 않은 Promise 거부:', error);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('🚨 처리되지 않은 예외:', error);
    process.exit(1);
});
