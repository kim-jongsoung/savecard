const http = require('http');
const querystring = require('querystring');

// 관리자 로그인 데이터
const loginData = querystring.stringify({
    username: 'admin',
    password: 'admin123'
});

// 로그인 요청 옵션
const loginOptions = {
    hostname: 'localhost',
    port: 3000,
    path: '/admin/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(loginData)
    }
};

console.log('🔐 관리자 로그인 테스트 시작...');

// 1단계: 관리자 로그인
const loginReq = http.request(loginOptions, (loginRes) => {
    console.log(`\n📡 로그인 응답 상태: ${loginRes.statusCode}`);
    console.log('로그인 응답 헤더:', loginRes.headers);
    
    // 세션 쿠키 추출
    const setCookieHeader = loginRes.headers['set-cookie'];
    let sessionCookie = '';
    
    if (setCookieHeader) {
        setCookieHeader.forEach(cookie => {
            if (cookie.includes('connect.sid')) {
                sessionCookie = cookie.split(';')[0];
                console.log('📝 세션 쿠키:', sessionCookie);
            }
        });
    }
    
    let loginData = '';
    loginRes.on('data', (chunk) => {
        loginData += chunk;
    });
    
    loginRes.on('end', () => {
        console.log('📄 로그인 응답 본문 길이:', loginData.length);
        
        if (loginRes.statusCode === 302) {
            console.log('✅ 로그인 성공 (리디렉션)');
            console.log('🔗 리디렉션 위치:', loginRes.headers.location);
            
            // 2단계: 제휴업체 신청 관리 페이지 접근
            if (sessionCookie) {
                testPartnerApplicationsPage(sessionCookie);
            } else {
                console.log('❌ 세션 쿠키를 찾을 수 없습니다.');
            }
        } else {
            console.log('❌ 로그인 실패');
            console.log('응답 본문:', loginData.substring(0, 500));
        }
    });
});

loginReq.on('error', (error) => {
    console.error('❌ 로그인 요청 오류:', error.message);
});

// 로그인 데이터 전송
loginReq.write(loginData);
loginReq.end();

// 제휴업체 신청 관리 페이지 테스트 함수
function testPartnerApplicationsPage(sessionCookie) {
    console.log('\n🧪 제휴업체 신청 관리 페이지 테스트 시작...');
    
    const pageOptions = {
        hostname: 'localhost',
        port: 3000,
        path: '/admin/partner-applications',
        method: 'GET',
        headers: {
            'Cookie': sessionCookie
        }
    };
    
    const pageReq = http.request(pageOptions, (pageRes) => {
        console.log(`\n📡 페이지 응답 상태: ${pageRes.statusCode}`);
        console.log('페이지 응답 헤더:', pageRes.headers);
        
        let pageData = '';
        pageRes.on('data', (chunk) => {
            pageData += chunk;
        });
        
        pageRes.on('end', () => {
            console.log('📄 페이지 응답 본문 길이:', pageData.length);
            
            if (pageRes.statusCode === 200) {
                console.log('✅ 제휴업체 신청 관리 페이지 접근 성공!');
                console.log('📋 페이지 내용 미리보기:', pageData.substring(0, 200));
            } else if (pageRes.statusCode === 404) {
                console.log('❌ 404 오류 - 페이지를 찾을 수 없습니다');
                console.log('📋 오류 페이지 내용:', pageData.substring(0, 500));
            } else {
                console.log(`❌ 예상치 못한 응답 상태: ${pageRes.statusCode}`);
                console.log('📋 응답 내용:', pageData.substring(0, 500));
            }
        });
    });
    
    pageReq.on('error', (error) => {
        console.error('❌ 페이지 요청 오류:', error.message);
    });
    
    pageReq.end();
}
