/**
 * 비즈고 알림톡 API 테스트
 * 간단한 메시지로 발송 테스트
 */

require('dotenv').config();
const axios = require('axios');

async function testAlimtalk() {
    const baseURL = process.env.BIZON_BASE_URL || 'https://mars.ibapi.kr';
    const apiKey = process.env.BIZON_API_KEY;
    const senderKey = process.env.BIZON_SENDER_KEY;
    const senderPhone = process.env.BIZON_SENDER_PHONE;

    console.log('📋 환경변수 확인:');
    console.log('- baseURL:', baseURL);
    console.log('- apiKey:', apiKey ? '설정됨' : '❌ 없음');
    console.log('- senderKey:', senderKey ? senderKey : '❌ 없음');
    console.log('- senderPhone:', senderPhone ? senderPhone : '❌ 없음');
    console.log('');

    // 테스트 데이터
    const testData = {
        to: '01039106260',  // 테스트 전화번호 (실제 번호로 변경)
        name: '테스트',
        productName: '돌핀투어',
        platformName: 'NOL',
        usageDate: '2025-11-15',
        voucherToken: 'TEST123456'
    };

    // API 요청 바디
    const requestBody = {
        messageFlow: [
            {
                alimtalk: {
                    senderKey: senderKey,
                    msgType: 'AL',  // AL: 알림톡 텍스트, AI: 알림톡 이미지
                    templateCode: 'VOUCHER_001',  // 실제 템플릿 코드로 변경
                    text: `[${testData.productName} 바우처]\n\n안녕하세요, ${testData.name}님\n\n${testData.platformName}에서 예약하신 상품의 바우처가 발급되었습니다.\n\n▶ 상품명: ${testData.productName}\n▶ 이용일: ${testData.usageDate}\n\n아래 버튼을 눌러 바우처와 이용시 안내사항을 꼭 확인하세요.`,
                    button: [
                        {
                            type: 'WL',
                            name: '바우처보기',
                            urlMobile: `https://www.guamsavecard.com/voucher/${testData.voucherToken}`,
                            urlPc: `https://www.guamsavecard.com/voucher/${testData.voucherToken}`
                        }
                    ]
                }
            }
        ],
        destinations: [
            {
                to: testData.to,
                ref: testData.voucherToken,
                fallback: {
                    from: senderPhone,
                    text: `[괌세이브카드 바우처]\n\n${testData.name}님, ${testData.productName} 바우처가 발급되었습니다.\n\n이용일: ${testData.usageDate}\n바우처 확인: https://www.guamsavecard.com/voucher/${testData.voucherToken}`,
                    type: 'LMS'
                }
            }
        ]
    };

    console.log('📤 전송할 요청:');
    console.log(JSON.stringify(requestBody, null, 2));
    console.log('');

    try {
        const response = await axios.post(
            `${baseURL}/api/comm/v1/send/omni`,
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': apiKey
                }
            }
        );

        console.log('✅ 발송 성공!');
        console.log('응답:', JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.error('❌ 발송 실패!');
        if (error.response) {
            console.error('상태 코드:', error.response.status);
            console.error('응답 데이터:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('에러 메시지:', error.message);
        }
    }
}

// 테스트 실행
testAlimtalk();
