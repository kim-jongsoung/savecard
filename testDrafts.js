const axios = require('axios');
require('dotenv').config();

// 테스트 설정
const BASE_URL = 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'your-secret-api-key';

const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
};

// 다양한 예약 텍스트 샘플
const sampleTexts = {
    nol_interpark: `
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
예약한 상품
괌 정글리버크루즈 원주민문화체험 맹글로브숲 수공예품만들기 물소타기
총 수량 3$304.00
개별이동 + 점심포함
이용예정일 2025-10-09
성인 2소아 1
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
`,
    
    klook_sample: `
KLOOK 예약 확인서
예약번호: KL789456123
상품명: 괌 스노클링 투어 + 점심 포함
예약일시: 2025-09-18 14:30:00
이용일: 2025-10-15
총 금액: $180.00
성인 2명 x $90.00
예약자: 김철수
이메일: chulsoo@gmail.com
전화: 010-1234-5678
영문명: KIM CHULSOO
호텔: 힐튼 괌 리조트
특별 요청사항: 
- 채식 점심 요청
- 수영 실력 초보자
- 오전 10시 픽업 희망
`,

    viator_sample: `
Viator Booking Confirmation
Booking Reference: VT2025091800123
Product: Guam Island Hopping Tour
Date: October 20, 2025
Time: 09:00 AM
Total: $450.00
Adults: 3 x $150.00
Customer: Sarah Johnson
Email: sarah.j@email.com
Phone: +1-555-0123
Hotel: Dusit Thani Guam Resort
Special Requirements:
- Vegetarian lunch option
- Wheelchair accessible
- Early morning pickup requested
Flight Info:
- Departure: UA154 Oct 18, 2025 06:30
- Return: UA155 Oct 22, 2025 14:45
Luggage: 2 golf bags, 1 stroller
`
};

/**
 * 파싱 테스트 실행
 */
async function testParsing() {
    console.log('🧪 예약 파싱 검수형 시스템 테스트 시작\n');
    
    for (const [type, rawText] of Object.entries(sampleTexts)) {
        console.log(`\n📋 ${type.toUpperCase()} 샘플 테스트`);
        console.log('='.repeat(50));
        
        try {
            // 1. 파싱 요청
            console.log('🔍 1단계: 파싱 요청 중...');
            const parseResponse = await axios.post(`${BASE_URL}/parse`, {
                rawText: rawText
            }, { headers });
            
            if (!parseResponse.data.success) {
                console.error('❌ 파싱 실패:', parseResponse.data.error);
                continue;
            }
            
            const draftId = parseResponse.data.draft_id;
            const confidence = parseResponse.data.confidence;
            const extractedNotes = parseResponse.data.extracted_notes;
            
            console.log('✅ 파싱 완료');
            console.log(`   드래프트 ID: ${draftId}`);
            console.log(`   신뢰도: ${confidence}`);
            console.log(`   추출 노트: ${extractedNotes}`);
            
            // 2. 드래프트 조회
            console.log('\n🔍 2단계: 드래프트 조회 중...');
            const draftResponse = await axios.get(`${BASE_URL}/drafts/${draftId}`, { headers });
            
            if (!draftResponse.data.success) {
                console.error('❌ 드래프트 조회 실패:', draftResponse.data.error);
                continue;
            }
            
            const draft = draftResponse.data.draft;
            console.log('✅ 드래프트 조회 완료');
            console.log(`   상태: ${draft.status}`);
            console.log(`   생성일: ${draft.created_at}`);
            
            // 3. 수동 수정 (예시)
            console.log('\n🔍 3단계: 수동 수정 적용 중...');
            const manualUpdates = {
                memo: `${draft.parsed_json.memo || ''} [검수자 추가] 테스트 데이터로 생성됨`,
                payment_status: 'confirmed'
            };
            
            const updateResponse = await axios.put(`${BASE_URL}/drafts/${draftId}`, {
                manual_json: manualUpdates
            }, { headers });
            
            if (!updateResponse.data.success) {
                console.error('❌ 드래프트 수정 실패:', updateResponse.data.error);
                continue;
            }
            
            console.log('✅ 수동 수정 완료');
            console.log(`   상태: ${updateResponse.data.draft.status}`);
            
            // 4. 커밋 (최종 예약 생성)
            console.log('\n🔍 4단계: 최종 예약 커밋 중...');
            const commitResponse = await axios.post(`${BASE_URL}/drafts/${draftId}/commit`, {}, { headers });
            
            if (!commitResponse.data.success) {
                console.error('❌ 커밋 실패:', commitResponse.data.error);
                if (commitResponse.data.validation) {
                    console.log('검증 오류:', commitResponse.data.validation);
                }
                continue;
            }
            
            const reservationId = commitResponse.data.reservation_id;
            const reservationNumber = commitResponse.data.reservation_number;
            
            console.log('✅ 커밋 완료');
            console.log(`   예약 ID: ${reservationId}`);
            console.log(`   예약 번호: ${reservationNumber}`);
            
            // 5. 최종 예약 조회
            console.log('\n🔍 5단계: 최종 예약 조회 중...');
            const bookingResponse = await axios.get(`${BASE_URL}/bookings/${reservationId}`, { headers });
            
            if (bookingResponse.data.success) {
                const booking = bookingResponse.data.booking;
                console.log('✅ 최종 예약 조회 완료');
                console.log(`   예약자: ${booking.korean_name} (${booking.english_first_name} ${booking.english_last_name})`);
                console.log(`   상품: ${booking.product_name}`);
                console.log(`   금액: $${booking.total_amount}`);
                console.log(`   이용일: ${booking.usage_date}`);
                console.log(`   상태: ${booking.payment_status}`);
            }
            
            console.log(`\n🎉 ${type.toUpperCase()} 테스트 완료!`);
            
        } catch (error) {
            console.error(`❌ ${type.toUpperCase()} 테스트 실패:`, error.message);
            if (error.response) {
                console.error('응답 데이터:', error.response.data);
            }
        }
        
        // 테스트 간 간격
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

/**
 * 예약 목록 조회 테스트
 */
async function testBookingsList() {
    console.log('\n📋 예약 목록 조회 테스트');
    console.log('='.repeat(50));
    
    try {
        const response = await axios.get(`${BASE_URL}/bookings?page=1&limit=10`, { headers });
        
        if (response.data.success) {
            const { bookings, pagination } = response.data;
            console.log('✅ 예약 목록 조회 완료');
            console.log(`   총 예약: ${pagination.total}개`);
            console.log(`   현재 페이지: ${pagination.page}/${pagination.pages}`);
            
            bookings.forEach((booking, index) => {
                console.log(`   ${index + 1}. ${booking.reservation_number} - ${booking.korean_name} - ${booking.product_name}`);
            });
        } else {
            console.error('❌ 예약 목록 조회 실패:', response.data.error);
        }
    } catch (error) {
        console.error('❌ 예약 목록 조회 오류:', error.message);
    }
}

/**
 * 메인 테스트 실행
 */
async function runTests() {
    console.log('🚀 예약 파싱 검수형 시스템 통합 테스트');
    console.log('서버 URL:', BASE_URL);
    console.log('API 키:', API_KEY ? '설정됨' : '미설정');
    console.log('');
    
    // 서버 연결 확인
    try {
        await axios.get(`${BASE_URL}/bookings?page=1&limit=1`, { headers });
        console.log('✅ 서버 연결 확인');
    } catch (error) {
        console.error('❌ 서버 연결 실패:', error.message);
        console.log('💡 server-drafts.js가 실행 중인지 확인하세요.');
        return;
    }
    
    await testParsing();
    await testBookingsList();
    
    console.log('\n🎯 모든 테스트 완료!');
}

// 환경변수 체크
if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');
    console.log('💡 .env 파일에 OPENAI_API_KEY=sk-your-key 를 추가하세요.');
    process.exit(1);
}

runTests();
