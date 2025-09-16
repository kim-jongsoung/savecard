// 실제 서버 API 테스트 스크립트
const https = require('https');

const testData = {
    test1: `NOL 인터파크 예약 확인서
예약번호: NOL20250115001
상품명: 괌 언더워터월드 입장권 + 돌핀 워칭 투어
이용일: 2025년 1월 20일
이용시간: 오전 10:00
예약자 정보:
한글명: 김철수
영문명: KIM CHULSOO
전화번호: 010-1234-5678
이메일: chulsoo@email.com
카카오톡 아이디: chulsoo123
인원수:
성인 2명
소아 1명
총 금액: 195,000원
결제상태: 결제완료`,

    test2: `상품명: 괌 돌핀 투어
이용일: 2025년 1월 25일
성인 1명
김영희
010-9876-5432`,

    test3: `박지영
010-5555-7777
괌 투어`
};

async function testAPI(testName, reservationText) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            reservationText: reservationText
        });

        const options = {
            hostname: 'savecard-production.up.railway.app',
            port: 443,
            path: '/api/register-reservation',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                console.log(`\n=== ${testName} 결과 ===`);
                console.log('상태 코드:', res.statusCode);
                console.log('응답 헤더:', res.headers);
                console.log('응답 데이터 (처음 200자):', responseData.substring(0, 200));
                
                try {
                    const result = JSON.parse(responseData);
                    
                    if (result.success) {
                        console.log('✅ 성공!');
                        console.log('파싱된 데이터:');
                        console.log('- 예약번호:', result.data.reservation_number);
                        console.log('- 플랫폼:', result.data.platform_name);
                        console.log('- 한글명:', result.data.korean_name);
                        console.log('- 영문명:', `${result.data.english_first_name || ''} ${result.data.english_last_name || ''}`.trim());
                        console.log('- 상품명:', result.data.product_name);
                        console.log('- 이용일:', result.data.usage_date);
                        console.log('- 전화번호:', result.data.phone);
                        console.log('- 이메일:', result.data.email);
                        console.log('- 성인수:', result.data.people_adult);
                        console.log('- 소아수:', result.data.people_child);
                        console.log('- 총금액:', result.data.total_amount);
                    } else {
                        console.log('❌ 실패:', result.message);
                    }
                    
                    resolve(result);
                } catch (error) {
                    console.log('❌ JSON 파싱 오류:', error.message);
                    console.log('응답 데이터:', responseData);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.log(`❌ ${testName} 요청 오류:`, error.message);
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

async function runTests() {
    console.log('🚀 예약 파싱 API 테스트 시작...');
    console.log('서버: https://savecard-production.up.railway.app');
    
    try {
        // 테스트 1: 완전한 NOL 데이터
        await testAPI('테스트 1 (완전한 NOL 데이터)', testData.test1);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 테스트 2: 부분 데이터
        await testAPI('테스트 2 (부분 데이터)', testData.test2);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 테스트 3: 최소 데이터
        await testAPI('테스트 3 (최소 데이터)', testData.test3);
        
        console.log('\n✅ 모든 테스트 완료!');
        
    } catch (error) {
        console.error('💥 테스트 실행 중 오류:', error.message);
    }
}

// 테스트 실행
runTests();
