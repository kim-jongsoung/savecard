const nodemailer = require('nodemailer');
const { OpenAI } = require('openai');

// OpenAI 클라이언트 초기화
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// SMTP 전송자 설정 (국제 호텔 전송 최적화)
function createTransporter() {
    const config = {
        host: process.env.SMTP_HOST || 'smtp.dooray.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        },
        // 국제 메일 전송 최적화
        tls: {
            rejectUnauthorized: false,
            minVersion: 'TLSv1.2'
        },
        // 타임아웃 설정 (국제 전송 고려)
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 30000,
        // 풀 설정
        pool: true,
        maxConnections: 5,
        maxMessages: 100
    };
    
    console.log('📧 SMTP 설정:', {
        host: config.host,
        port: config.port,
        secure: config.secure,
        user: config.auth.user
    });
    
    return nodemailer.createTransport(config);
}

// AI로 정중한 이메일 문구 생성
async function generateEmailContent(assignmentData) {
    try {
        const senderName = assignmentData.created_by || '괌 예약팀';
        const senderEmail = assignmentData.created_by_email || 'support@guamsavecard.com';
        
        const prompt = `당신은 ${senderName} 담당자입니다. 현지 수배업체에게 예약 수배를 요청하는 정중한 이메일 문구를 작성해주세요.

담당자 정보:
- 이름: ${senderName}
- 이메일: ${senderEmail}

예약 정보:
- 상품명: ${assignmentData.product_name}
- 고객명: ${assignmentData.customer_name}
- 이용일: ${assignmentData.usage_date}
- 인원: 성인 ${assignmentData.adult_count || 0}명, 아동 ${assignmentData.child_count || 0}명
- 예약번호: ${assignmentData.reservation_number}

요구사항:
1. 정중하고 전문적인 비즈니스 톤
2. 수배서 링크를 클릭하여 상세 내용을 확인해달라는 안내
3. 확정 후 회신 부탁
4. 3-4문장 정도의 간결한 내용
5. 인사말로 시작하고 감사 인사로 마무리
6. 한국어로 작성
7. "세이브카드" 또는 "괌세이브카드" 라는 표현 사용 금지 - 대신 담당자 이름 사용
8. 담당자 연락처를 포함할 것

출력 형식: JSON
{
  "subject": "이메일 제목",
  "greeting": "인사말",
  "body": "본문 내용 (2-3문장)",
  "closing": "마무리 인사"
}`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: '당신은 예약 담당자입니다. 현지 수배업체와의 소통을 위한 정중하고 전문적인 이메일을 작성합니다. "세이브카드" 또는 "괌세이브카드" 같은 회사명 대신 담당자 개인의 이름으로 서명해야 합니다.'
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
        console.log('✅ AI 이메일 문구 생성 완료:', content.subject);
        return content;

    } catch (error) {
        console.error('❌ AI 문구 생성 실패:', error);
        // 폴백: 기본 문구 반환
        const senderName = assignmentData.created_by || '괌 예약팀';
        return {
            subject: `[수배 요청] ${assignmentData.product_name}`,
            greeting: '안녕하세요.',
            body: `${assignmentData.product_name} 예약에 대한 수배를 요청드립니다.\n아래 수배서 링크를 클릭하여 상세 내용을 확인해주시고, 확정 후 회신 부탁드립니다.`,
            closing: '감사합니다.'
        };
    }
}

// HTML 이메일 템플릿 생성
function createEmailHTML(emailContent, assignmentLink, assignmentData) {
    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${emailContent.subject}</title>
    <style>
        body {
            font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 10px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px 8px 0 0;
            margin: -30px -30px 20px -30px;
        }
        .header h1 {
            margin: 0;
            font-size: 22px;
        }
        .content {
            margin: 20px 0;
        }
        .info-box {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
        }
        .info-box p {
            margin: 5px 0;
        }
        .info-box strong {
            color: #667eea;
        }
        .button-container {
            text-align: center;
            margin: 30px 0;
        }
        .button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white !important;
            text-decoration: none;
            padding: 15px 40px;
            border-radius: 25px;
            font-weight: bold;
            font-size: 16px;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        .button:hover {
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            font-size: 12px;
            color: #999;
            text-align: center;
        }
        .link-text {
            font-size: 12px;
            color: #666;
            word-break: break-all;
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏝️ 수배 요청</h1>
        </div>
        
        <div class="content">
            <p>${emailContent.greeting}</p>
            
            <p>${emailContent.body}</p>
            
            <div class="info-box">
                <p><strong>📋 예약번호:</strong> ${assignmentData.reservation_number}</p>
                <p><strong>🎯 상품명:</strong> ${assignmentData.product_name}</p>
                <p><strong>👤 고객명:</strong> ${assignmentData.customer_name}</p>
                <p><strong>📅 이용일:</strong> ${assignmentData.usage_date || '-'}</p>
                <p><strong>👥 인원:</strong> 성인 ${assignmentData.adult_count || 0}명, 아동 ${assignmentData.child_count || 0}명</p>
            </div>
            
            <div class="button-container">
                <a href="${assignmentLink}" class="button">
                    📄 수배서 확인하기
                </a>
            </div>
            
            <p class="link-text">
                또는 아래 링크를 복사하여 브라우저에서 열어주세요:<br>
                <a href="${assignmentLink}">${assignmentLink}</a>
            </p>
            
            <p style="margin-top: 30px;">${emailContent.closing}</p>
            <p><strong>${assignmentData.created_by || '괌 예약팀'}</strong></p>
            <p style="font-size: 14px; color: #666; margin-top: 10px;">
                <i class="bi bi-envelope"></i> ${assignmentData.created_by_email || 'support@guamsavecard.com'}
            </p>
        </div>
        
        <div class="footer">
            <p>본 메일은 예약 관리 시스템에서 자동 발송되었습니다.</p>
            <p>문의사항이 있으시면 회신 부탁드립니다.</p>
        </div>
    </div>
</body>
</html>
    `;
}

// 수배서 이메일 발송
async function sendAssignmentEmail(assignmentData, recipientEmail) {
    try {
        console.log('📧 수배서 이메일 발송 시작...');
        console.log('📧 수신자:', recipientEmail);
        
        // 1. AI로 이메일 문구 생성
        const emailContent = await generateEmailContent(assignmentData);
        
        // 2. 수배서 링크 생성
        const assignmentLink = `${process.env.BASE_URL || 'https://www.guamsavecard.com'}/assignment/${assignmentData.assignment_token}`;
        
        // 3. HTML 이메일 생성
        const htmlContent = createEmailHTML(emailContent, assignmentLink, assignmentData);
        
        // 4. 이메일 발송
        const transporter = createTransporter();
        
        const senderName = assignmentData.created_by || '괌 예약팀';
        const senderEmail = assignmentData.created_by_email || 'support@guamsavecard.com';
        
        const mailOptions = {
            from: `"${process.env.SMTP_FROM_NAME || 'LUXFIND Reservation Team'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
            replyTo: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: recipientEmail,
            subject: emailContent.subject,
            html: htmlContent,
            // 스팸 필터 통과를 위한 헤더
            headers: {
                'X-Mailer': 'LUXFIND Reservation System',
                'X-Priority': '1',
                'Importance': 'high',
                'X-MSMail-Priority': 'High'
            },
            priority: 'high',
            // 텍스트 버전 (필수 - 스팸 방지)
            text: `
${emailContent.greeting}

${emailContent.body}

예약번호: ${assignmentData.reservation_number}
상품명: ${assignmentData.product_name}
고객명: ${assignmentData.customer_name}
이용일: ${assignmentData.usage_date || '-'}
인원: 성인 ${assignmentData.adult_count || 0}명, 아동 ${assignmentData.child_count || 0}명

수배서 확인: ${assignmentLink}

${emailContent.closing}

${senderName}
연락처: ${senderEmail}
            `.trim()
        };
        
        const info = await transporter.sendMail(mailOptions);
        
        console.log('✅ 이메일 발송 완료:', info.messageId);
        console.log('📧 수신자:', recipientEmail);
        
        return {
            success: true,
            messageId: info.messageId,
            assignmentLink: assignmentLink
        };
        
    } catch (error) {
        console.error('❌ 이메일 발송 실패:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// 테스트 이메일 발송
async function sendTestEmail(toEmail) {
    try {
        const transporter = createTransporter();
        
        const mailOptions = {
            from: `"괌세이브카드 테스트" <${process.env.SMTP_USER}>`,
            to: toEmail,
            subject: '🧪 SMTP 연결 테스트',
            html: `
                <h2>SMTP 연결 테스트 성공!</h2>
                <p>이메일 발송 기능이 정상적으로 작동합니다.</p>
                <p>발송 시간: ${new Date().toLocaleString('ko-KR')}</p>
            `
        };
        
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ 테스트 이메일 발송 완료:', info.messageId);
        return { success: true, messageId: info.messageId };
        
    } catch (error) {
        console.error('❌ 테스트 이메일 발송 실패:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendAssignmentEmail,
    sendTestEmail,
    generateEmailContent
};
