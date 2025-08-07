const http = require('http');

// 테스트 데이터
const testData = JSON.stringify({
    businessName: "테스트 업체",
    contactName: "홍길동", 
    email: "test@example.com"
});

// HTTP 요청 옵션
const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/partner-application',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(testData)
    }
};

console.log('🧪 제휴업체 신청 API 테스트 시작...');
console.log('요청 데이터:', testData);
console.log('요청 옵션:', options);

// HTTP 요청 생성
const req = http.request(options, (res) => {
    console.log(`\n📡 응답 상태: ${res.statusCode}`);
    console.log('응답 헤더:', res.headers);
    
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log('\n📄 응답 본문:', data);
        
        try {
            const jsonResponse = JSON.parse(data);
            console.log('📋 파싱된 응답:', jsonResponse);
            
            if (jsonResponse.success) {
                console.log('✅ 테스트 성공!');
            } else {
                console.log('❌ 테스트 실패:', jsonResponse.message);
            }
        } catch (error) {
            console.log('❌ JSON 파싱 오류:', error.message);
        }
    });
});

// 오류 처리
req.on('error', (error) => {
    console.error('❌ 요청 오류:', error.message);
});

// 요청 데이터 전송
req.write(testData);
req.end();

console.log('📤 요청 전송 완료, 응답 대기 중...');
