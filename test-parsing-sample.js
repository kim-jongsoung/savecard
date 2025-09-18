const { parseBooking } = require('./utils/aiParser');

// 실제 예약 데이터 샘플
const sampleReservationText = `
괌 정글리버크루즈 원주민문화체험 맹글로브숲 수공예품만들기 물소타기
괌 정글리버크루즈
예약확정
예약 일시
2025-09-17 02:27:14
예약 번호
459447
예약 확인 번호
PROD:d7cb49
예약 채널
NOL 인터파크
2025-09-17 11:22:47 바우처등록 - VASCO
2025-09-17 11:22:46 예약확정 - VASCO
2025-09-17 02:27:14 예약접수
예약 히스토리 닫기
예약한 상품
괌 정글리버크루즈 원주민문화체험 맹글로브숲 수공예품만들기 물소타기
괌 정글리버크루즈
총 수량 3$304.00
개별이동 + 점심포함
이용예정일 2025-10-09
성인 2소아 1
이용예정일 변경예약 아이템 상세 보기
판매 금액 상세 보기취소 환불 규정 보기
바우처
459447_괌 정글리버크루즈 원주민문화체험 맹글로브숲 수공예품만들기 물소타기_구*모_2025-10-09_1
PDF · 459447
2025-09-17 11:22:47
유효
예약자 정보
이름
구병모
이메일
ddendden@naver.com
전화번호
+82 10-7939-3990
예약 정보
대표 예약 정보
전화번호*
010-7939-3990
이메일*
ddendden@naver.com
영문 성*
KU
영문 이름*
BYUNGMO
호텔*
츠바키
카카오톡 아이디*
ddendde
메모
메모 등록
트리플 투어 파트너 센터
바우처 전송예약 취소
`;

// 기대하는 결과
const expectedResult = {
  "reservation_number": "459447",
  "confirmation_number": "PROD:d7cb49",
  "channel": "NOL 인터파크",
  "product_name": "괌 정글리버크루즈 원주민문화체험 맹글로브숲 수공예품만들기 물소타기",
  "total_amount": 304.00,
  "package_type": "개별이동 + 점심포함",
  "usage_date": "2025-10-09",
  "usage_time": null,
  "quantity": 3,
  "korean_name": "구병모",
  "english_first_name": "BYUNGMO",
  "english_last_name": "KU",
  "email": "ddendden@naver.com",
  "phone": "010-7939-3990",
  "kakao_id": "ddendde",
  "guest_count": 3,
  "memo": "호텔: 츠바키. 카카오톡 아이디: ddendde. 기타 정보: 개별이동 + 점심포함 패키지, 성인 2명 소아 1명 총 3명, 이용예정일 2025-10-09",
  "reservation_datetime": "2025-09-17T02:27:14",
  "platform_name": "VASCO",
  "people_adult": 2,
  "people_child": 1,
  "people_infant": 0,
  "adult_unit_price": 101.33,
  "child_unit_price": 101.33,
  "payment_status": "confirmed",
  "code_issued": true,
  "code_issued_at": "2025-09-17T11:22:47"
};

async function testParsing() {
    console.log('🧪 OpenAI 파싱 테스트 시작...\n');
    
    try {
        const result = await parseBooking(sampleReservationText);
        
        console.log('📋 파싱 결과:');
        console.log(JSON.stringify(result, null, 2));
        
        console.log('\n🎯 기대 결과와 비교:');
        
        // 주요 필드 검증
        const keyFields = [
            'reservation_number',
            'confirmation_number', 
            'channel',
            'product_name',
            'total_amount',
            'package_type',
            'usage_date',
            'korean_name',
            'english_first_name',
            'english_last_name',
            'email',
            'phone',
            'kakao_id',
            'people_adult',
            'people_child',
            'payment_status',
            'code_issued'
        ];
        
        let matchCount = 0;
        keyFields.forEach(field => {
            const actual = result[field];
            const expected = expectedResult[field];
            const match = actual === expected;
            
            if (match) matchCount++;
            
            console.log(`${match ? '✅' : '❌'} ${field}: ${actual} ${match ? '' : `(기대값: ${expected})`}`);
        });
        
        console.log(`\n📊 정확도: ${matchCount}/${keyFields.length} (${Math.round(matchCount/keyFields.length*100)}%)`);
        
    } catch (error) {
        console.error('❌ 테스트 실패:', error);
    }
}

// 환경변수 체크
if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');
    console.log('💡 .env 파일에 OPENAI_API_KEY=sk-your-key 를 추가하세요.');
    process.exit(1);
}

testParsing();
