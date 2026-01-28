const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

// OpenAI 클라이언트 초기화
let openai = null;
try {
    if (process.env.OPENAI_API_KEY) {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        console.log('✅ OpenAI 클라이언트 초기화 성공 (패키지 파서)');
    } else {
        console.log('⚠️ OPENAI_API_KEY 환경변수가 설정되지 않음');
    }
} catch (error) {
    console.error('❌ OpenAI 클라이언트 초기화 실패:', error.message);
}

// 인증 미들웨어
const requireAuth = (req, res, next) => {
    if (!req.session.adminId) {
        return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }
    next();
};

// 패키지 예약 AI 파싱
router.post('/parse-package-reservation', requireAuth, async (req, res) => {
    try {
        const { text } = req.body;
        
        if (!text || text.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: '파싱할 텍스트를 입력해주세요.'
            });
        }
        
        if (!openai) {
            return res.status(500).json({
                success: false,
                message: 'OpenAI API 키가 설정되지 않았습니다.'
            });
        }
        
        console.log('🤖 패키지 예약 AI 파싱 시작...');
        console.log('📝 입력 텍스트 길이:', text.length);
        
        const systemPrompt = `
당신은 패키지 여행 예약 데이터를 분석하는 전문가입니다.
사용자가 붙여넣은 예약 텍스트를 분석하여 JSON 형식으로 변환해주세요.

📋 출력 JSON 구조:
{
    "platform_name": "예약 채널명 (네이버, 인터파크, 하나투어 등)",
    "package_name": "패키지 상품명",
    "customer": {
        "korean_name": "고객 한글명",
        "english_name": "고객 영문명 (HONG GILDONG 형식)",
        "phone": "연락처",
        "email": "이메일"
    },
    "travel_period": {
        "departure_date": "출발일 (YYYY-MM-DD)",
        "return_date": "귀국일 (YYYY-MM-DD)"
    },
    "people": {
        "adult": 성인수 (숫자),
        "child": 소아수 (숫자),
        "infant": 유아수 (숫자)
    },
    "flight_info": {
        "outbound_flight": "출국편 항공편명",
        "outbound_departure_time": "출국편 출발시간 (HH:MM)",
        "outbound_arrival_time": "출국편 도착시간 (HH:MM)",
        "inbound_flight": "입국편 항공편명",
        "inbound_departure_time": "입국편 출발시간 (HH:MM)",
        "inbound_arrival_time": "입국편 도착시간 (HH:MM)"
    },
    "hotel_name": "호텔명",
    "room_type": "객실 타입",
    "itinerary": "일정 (여러 줄 가능)",
    "inclusions": "포함사항",
    "exclusions": "불포함사항",
    "pricing": {
        "currency": "통화 (KRW 또는 USD)",
        "exchange_rate": 환율 (숫자, KRW면 1),
        "price_adult": 성인 1인 요금 (숫자),
        "price_child": 소아 1인 요금 (숫자),
        "price_infant": 유아 1인 요금 (숫자)
    },
    "guests": [
        {
            "korean_name": "투숙객 한글명",
            "english_name": "투숙객 영문명",
            "birth_date": "생년월일 (YYYY-MM-DD)",
            "phone": "연락처",
            "email": "이메일",
            "type": "성인/소아/유아"
        }
    ],
    "special_requests": "특별 요청사항",
    "confidence": 파싱 신뢰도 (0.0~1.0)
}

📌 중요 규칙:
1. 모든 필드는 가능한 한 추출하되, 정보가 없으면 null 또는 빈 문자열
2. 날짜는 반드시 YYYY-MM-DD 형식
3. 시간은 HH:MM 형식 (24시간제)
4. 금액은 숫자만 (쉼표 제거)
5. 인원수는 정수
6. 영문명은 대문자로 (HONG GILDONG)
7. 항공편명은 항공사 코드 + 숫자 (예: OZ601, KE123)
8. confidence는 파싱 결과의 신뢰도 (0.0~1.0)

💡 파싱 팁:
- "성인 2명, 소아 1명" → adult: 2, child: 1
- "3박 4일" → 출발일과 귀국일 계산
- "왕복 항공권" → 출국편과 입국편 분리
- "조식 포함" → inclusions에 추가
- 총 금액이 있으면 인원수로 나눠서 1인 요금 계산

⚠️ 주의사항:
- JSON만 출력하고 다른 설명은 포함하지 마세요
- 확실하지 않은 정보는 null로 처리
- 여러 투숙객 정보가 있으면 guests 배열에 모두 포함
`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `다음 패키지 예약 텍스트를 분석해주세요:\n\n${text}` }
            ],
            temperature: 0.3,
            max_tokens: 4000
        });

        const responseText = completion.choices[0].message.content.trim();
        console.log('🤖 OpenAI 응답:', responseText.substring(0, 200) + '...');

        // JSON 파싱
        let parsedData;
        try {
            // JSON 코드 블록 제거 (```json ... ``` 형식)
            const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || 
                             responseText.match(/```\s*([\s\S]*?)\s*```/);
            const jsonText = jsonMatch ? jsonMatch[1] : responseText;
            
            parsedData = JSON.parse(jsonText);
            console.log('✅ JSON 파싱 성공');
        } catch (parseError) {
            console.error('❌ JSON 파싱 실패:', parseError.message);
            return res.status(500).json({
                success: false,
                message: 'AI 응답을 JSON으로 변환하는데 실패했습니다.',
                rawResponse: responseText
            });
        }

        res.json({
            success: true,
            data: parsedData,
            message: 'AI 파싱이 완료되었습니다.'
        });

    } catch (error) {
        console.error('❌ 패키지 예약 AI 파싱 실패:', error);
        res.status(500).json({
            success: false,
            message: 'AI 파싱 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

module.exports = router;
