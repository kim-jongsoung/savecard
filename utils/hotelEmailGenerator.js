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
        const senderName = assignmentData.agency_contact_person || 'LUXFIND';
        const senderEmail = assignmentData.agency_contact_email || process.env.SMTP_FROM || 'res@lux-find.com';
        const assignmentType = assignmentData.assignment_type || 'NEW';
        
        // 상황별 프롬프트 설정
        let contextPrompt = '';
        if (assignmentType === 'NEW') {
            contextPrompt = `
Context: This is a new hotel booking request.
Key message: "Please kindly arrange this reservation."
Tone: Polite and professional business English.
`;
        } else if (assignmentType === 'REVISE') {
            contextPrompt = `
Context: This is a modification request for an existing reservation. (Revision no.: #${assignmentData.revision_number})
Change reason: ${assignmentData.changes_description || 'Customer request'}
Key message: "Sorry for the inconvenience, but please update the booking according to the changes."
Tone: Polite and apologetic, professional business English.
`;
        } else if (assignmentType === 'CANCEL') {
            contextPrompt = `
Context: This is a cancellation request for an existing reservation.
Cancellation reason: ${assignmentData.changes_description || 'Customer request'}
Key message: "We are sorry for the inconvenience, but please cancel this reservation."
Tone: Polite and apologetic, professional business English.
`;
        }

        const prompt = `You are ${senderName} from LUXFIND. Please write an email in English to the hotel reservation team.

${contextPrompt}

Reservation details:
- Hotel name: ${assignmentData.hotel_name}
- Guest name: ${assignmentData.rooms && assignmentData.rooms[0] && assignmentData.rooms[0].guests && assignmentData.rooms[0].guests[0] ? assignmentData.rooms[0].guests[0].english_name : 'Guest'}
- Check-in date: ${new Date(assignmentData.check_in_date).toLocaleDateString('en-CA')}
- Check-out date: ${new Date(assignmentData.check_out_date).toLocaleDateString('en-CA')}
- Number of rooms: ${assignmentData.rooms ? assignmentData.rooms.length : 1}

Requirements:
1. Ask the hotel to click the assignment link to check full details.
2. Politely request the hotel to send back the confirmation number.
3. Keep it concise (about 3-5 sentences).
4. Start with a greeting and end with a thank you.
5. Write everything in English.
6. Sign as ${senderName} from LUXFIND.
7. DO NOT include any email address in the email body. The email signature will be added automatically.

Output format: JSON
{
  "subject": "Email subject (e.g. [New Booking] Hotel Name - Guest Name)",
  "greeting": "Greeting sentence",
  "body": "Main body text",
  "closing": "Closing sentence with thanks"
}`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are a hotel reservation coordinator. You write polite and professional business emails in English to hotel partners. Respond only in valid JSON.'
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
        const senderName = assignmentData.agency_contact_person || 'LUXFIND';
        const typeLabel = assignmentData.assignment_type === 'NEW' ? 'NEW BOOKING' : 
                          (assignmentData.assignment_type === 'REVISE' ? `REVISED BOOKING #${assignmentData.revision_number}` : 'CANCELLATION');
        const checkInLabel = assignmentData.check_in_date
            ? new Date(assignmentData.check_in_date).toLocaleDateString('en-CA')
            : '';
        
        let bodyText = '';
        if (assignmentData.assignment_type === 'NEW') {
            bodyText = 'This is a new booking request. Please review the assignment document via the link below and kindly confirm the reservation with a confirmation number.';
        } else if (assignmentData.assignment_type === 'REVISE') {
            bodyText = `There are some changes to the existing reservation. Please review and update the booking accordingly.\nChange reason: ${assignmentData.changes_description}`;
        } else {
            bodyText = `We kindly request the cancellation of this reservation.\nCancellation reason: ${assignmentData.changes_description}`;
        }

        return {
            subject: `[${typeLabel}] ${assignmentData.hotel_name} - ${assignmentData.rooms?.[0]?.guests?.[0]?.english_name || 'Guest'} ${checkInLabel ? '| Check-in ' + checkInLabel : ''}`,
            greeting: 'Dear Hotel Reservation Team,',
            body: bodyText,
            closing: `Best regards,\n${senderName} (LUXFIND)`
        };
    }
}

module.exports = {
    generateHotelEmailContent
};
