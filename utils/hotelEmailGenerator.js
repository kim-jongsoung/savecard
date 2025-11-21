const { OpenAI } = require('openai');

// OpenAI 클라이언트 초기화
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * 호텔 수배서용 AI 이메일 문구 생성
 * @param {Object} assignmentData - 수배서 데이터
 * @returns {Object} - { subject, greeting, body, closing }
 */
async function generateHotelEmailContent(assignmentData) {
    try {
        const senderName = assignmentData.agency_contact_person || 'Guam Reservation Team';
        const senderEmail = assignmentData.agency_contact_email || 'support@guamsavecard.com';
        const assignmentType = assignmentData.assignment_type || 'NEW';
        
        // 상황별 프롬프트 설정
        let contextPrompt = '';
        if (assignmentType === 'NEW') {
            contextPrompt = `
상황: 신규 호텔 예약 요청입니다.
핵심 메시지: "예약 잘 부탁드립니다."
톤앤매너: 정중하고 전문적인 비즈니스 톤. 
`;
        } else if (assignmentType === 'REVISE') {
            contextPrompt = `
상황: 기존 예약의 수정 요청입니다. (수정 회차: #${assignmentData.revision_number})
변경 사유: ${assignmentData.changes_description || '고객 요청'}
핵심 메시지: "바쁘시겠지만 변경사항이 있어 수정을 부탁드립니다."
톤앤매너: 상대방의 번거로움을 배려하는 미안함과 정중함이 담긴 톤.
`;
        } else if (assignmentType === 'CANCEL') {
            contextPrompt = `
상황: 기존 예약의 취소 요청입니다.
취소 사유: ${assignmentData.changes_description || '고객 요청'}
핵심 메시지: "불편을 드려 죄송합니다. 부득이하게 취소를 부탁드립니다."
톤앤매너: 정중한 사과와 양해를 구하는 톤.
`;
        }

        const prompt = `당신은 ${senderName} 담당자입니다. 호텔 예약 담당자에게 보내는 이메일 문구를 작성해주세요.

${contextPrompt}

예약 정보:
- 호텔명: ${assignmentData.hotel_name}
- 고객명: ${assignmentData.rooms && assignmentData.rooms[0] && assignmentData.rooms[0].guests && assignmentData.rooms[0].guests[0] ? assignmentData.rooms[0].guests[0].english_name : 'Guest'}
- 체크인: ${new Date(assignmentData.check_in_date).toLocaleDateString()}
- 체크아웃: ${new Date(assignmentData.check_out_date).toLocaleDateString()}
- 객실 수: ${assignmentData.rooms ? assignmentData.rooms.length : 1}개

요구사항:
1. 수배서 링크를 클릭하여 상세 내용을 확인해달라는 안내 포함
2. 확정 번호(Confirmation Number) 회신 부탁
3. 3-5문장 정도의 간결한 내용
4. 인사말로 시작하고 감사 인사로 마무리
5. 한국어로 작성 (호텔 담당자가 한국인이라고 가정)
6. "세이브카드" 같은 회사명 대신 담당자 이름(${senderName})으로 서명
7. 담당자 연락처(${senderEmail}) 포함

출력 형식: JSON
{
  "subject": "이메일 제목 (예: [New Booking] Hotel Name - Guest Name)",
  "greeting": "인사말",
  "body": "본문 내용",
  "closing": "마무리 인사"
}`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: '당신은 호텔 예약 담당자입니다. 호텔 측 담당자와 소통하는 정중하고 프로페셔널한 이메일을 작성합니다. JSON 형식으로만 응답하세요.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.7
        });

        const content = JSON.parse(response.choices[0].message.content);
        console.log(`✅ 호텔 AI 이메일 문구 생성 완료 (${assignmentType}):`, content.subject);
        return content;

    } catch (error) {
        console.error('❌ 호텔 AI 문구 생성 실패:', error);
        
        // 폴백: 기본 문구 반환
        const senderName = assignmentData.agency_contact_person || 'Guam Reservation Team';
        const typeLabel = assignmentData.assignment_type === 'NEW' ? 'New Booking' : 
                          (assignmentData.assignment_type === 'REVISE' ? `REVISION #${assignmentData.revision_number}` : 'CANCELLATION');
        
        let bodyText = '';
        if (assignmentData.assignment_type === 'NEW') {
            bodyText = '새로운 예약 요청입니다. 아래 링크를 통해 상세 내용을 확인하시고 예약 확정 부탁드립니다.';
        } else if (assignmentData.assignment_type === 'REVISE') {
            bodyText = `예약 변경사항이 있습니다. 번거로우시겠지만 확인 후 수정 부탁드립니다.\n변경 사유: ${assignmentData.changes_description}`;
        } else {
            bodyText = `죄송하지만 해당 예약의 취소를 요청드립니다.\n취소 사유: ${assignmentData.changes_description}`;
        }

        return {
            subject: `[${typeLabel}] ${assignmentData.hotel_name} - ${assignmentData.rooms?.[0]?.guests?.[0]?.english_name || 'Guest'}`,
            greeting: '안녕하세요.',
            body: bodyText,
            closing: '감사합니다.'
        };
    }
}

module.exports = {
    generateHotelEmailContent
};
