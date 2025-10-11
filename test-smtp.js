// SMTP 연결 테스트 스크립트
require('dotenv').config({ path: './railsql.env' });
const nodemailer = require('nodemailer');

console.log('🧪 SMTP 연결 테스트 시작...\n');

// 환경변수 확인
console.log('📋 환경변수 확인:');
console.log('SMTP_HOST:', process.env.SMTP_HOST);
console.log('SMTP_PORT:', process.env.SMTP_PORT);
console.log('SMTP_SECURE:', process.env.SMTP_SECURE);
console.log('SMTP_USER:', process.env.SMTP_USER);
console.log('SMTP_PASS:', process.env.SMTP_PASS ? '****' + process.env.SMTP_PASS.slice(-4) : 'undefined');
console.log('');

// SMTP 전송자 설정
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    debug: true, // 디버그 모드
    logger: true // 로그 출력
});

// 연결 테스트
async function testConnection() {
    try {
        console.log('🔌 SMTP 서버 연결 테스트 중...\n');
        await transporter.verify();
        console.log('✅ SMTP 서버 연결 성공!\n');
        
        // 테스트 이메일 발송
        console.log('📧 테스트 이메일 발송 중...\n');
        const info = await transporter.sendMail({
            from: `"괌세이브카드 테스트" <${process.env.SMTP_USER}>`,
            to: process.env.SMTP_USER, // 본인에게 발송
            subject: '🧪 SMTP 테스트 메일',
            html: `
                <h2>✅ SMTP 연결 테스트 성공!</h2>
                <p>이메일 발송 기능이 정상적으로 작동합니다.</p>
                <hr>
                <p><strong>SMTP 서버:</strong> ${process.env.SMTP_HOST}</p>
                <p><strong>포트:</strong> ${process.env.SMTP_PORT}</p>
                <p><strong>보안:</strong> ${process.env.SMTP_SECURE === 'true' ? 'SSL' : 'TLS'}</p>
                <p><strong>발송 시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
            `,
            text: `SMTP 연결 테스트 성공! 발송 시간: ${new Date().toLocaleString('ko-KR')}`
        });
        
        console.log('✅ 테스트 이메일 발송 완료!');
        console.log('📧 Message ID:', info.messageId);
        console.log('📬 수신 메일함을 확인하세요:', process.env.SMTP_USER);
        
    } catch (error) {
        console.error('❌ SMTP 테스트 실패:', error.message);
        console.error('\n상세 오류:', error);
        
        // 일반적인 오류 해결 방법 안내
        console.log('\n💡 해결 방법:');
        
        if (error.message.includes('authentication') || error.message.includes('Invalid login')) {
            console.log('- 네이버 메일 계정 정보를 확인하세요');
            console.log('- 비밀번호가 정확한지 확인하세요');
            console.log('- 네이버 메일 설정에서 IMAP/SMTP 사용이 활성화되어 있는지 확인하세요');
        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
            console.log('- SMTP 서버 주소와 포트를 확인하세요');
            console.log('- 방화벽 설정을 확인하세요');
            console.log('- 인터넷 연결을 확인하세요');
        } else if (error.message.includes('self signed certificate')) {
            console.log('- SSL/TLS 인증서 문제입니다');
            console.log('- SMTP_SECURE 설정을 확인하세요');
        }
        
        process.exit(1);
    }
}

testConnection();
