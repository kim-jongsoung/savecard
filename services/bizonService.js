/**
 * 비즈고(Bizgo) 알림톡 발송 서비스
 * 비즈고 Communication API를 사용하여 카카오 알림톡 전송
 */

const axios = require('axios');

class BizonService {
    constructor() {
        this.baseURL = process.env.BIZON_BASE_URL || 'https://mars.ibapi.kr';
        this.apiKey = process.env.BIZON_API_KEY;  // API Key (Authorization 헤더용)
        this.senderKey = process.env.BIZON_SENDER_KEY;  // 카카오 발신프로필키
        this.senderPhone = process.env.BIZON_SENDER_PHONE;
    }

    /**
     * API 헤더 생성
     */
    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey  // API Key
        };
    }

    /**
     * 발급 코드 알림톡 전송
     * @param {Object} params - 전송 파라미터
     * @param {string} params.to - 수신자 전화번호 (01012345678)
     * @param {string} params.name - 고객 이름
     * @param {string} params.code - 발급 코드
     * @param {string} params.expireDate - 유효기간
     */
    async sendIssueCodeAlimtalk({ to, name, code, expireDate }) {
        try {
            // 전화번호 포맷 정리 (하이픈 제거)
            const phoneNumber = to.replace(/[^0-9]/g, '');

            // 비즈고 API 정확한 요청 형식
            const requestBody = {
                messageFlow: [
                    {
                        alimtalk: {
                            senderKey: this.senderKey,  // 카카오 발신프로필키
                            msgType: 'AL',  // 알림톡 텍스트 (AL: 알림톡, AI: 알림톡 이미지)
                            templateCode: 'ISSUE_CODE_001',  // 템플릿 코드
                            // 템플릿 원본 그대로 (#{변수명} 형식)
                            text: `[괌세이브카드] 발급코드 안내\n\n안녕하세요, #{NAME}님!\n괌세이브카드 발급코드를 안내드립니다.\n\n━━━━━━━━━━━━━━━━━━\n📌 발급코드: #{CODE}\n━━━━━━━━━━━━━━━━━━\n\n위 코드로 괌세이브카드를 발급받으실 수 있습니다.\n\n※ 발급코드는 1회만 사용 가능합니다.\n※ 발급 유효기간: #{EXPIRE_DATE}까지\n\n문의사항이 있으시면 언제든 연락주세요.\n감사합니다.`,
                            button: [
                                {
                                    type: 'WL',
                                    name: '카드 발급하기',
                                    urlMobile: 'https://www.guamsavecard.com/register',
                                    urlPc: 'https://www.guamsavecard.com/register'
                                },
                                {
                                    type: 'WL',
                                    name: '가맹점 보기',
                                    urlMobile: 'https://www.guamsavecard.com/stores',
                                    urlPc: 'https://www.guamsavecard.com/stores'
                                }
                            ]
                        }
                    }
                ],
                destinations: [
                    {
                        to: phoneNumber,
                        ref: code,  // 추적용 참조값 (발급 코드)
                        // 변수 치환 (키는 변수명만, #{} 제외)
                        replaceWords: {
                            'NAME': name,
                            'CODE': code,
                            'EXPIRE_DATE': expireDate
                        },
                        // 알림톡 실패 시 자동 SMS 발송
                        fallback: {
                            from: this.senderPhone,
                            text: `[괌세이브카드 발급코드]\n\n${name}님, 발급코드: ${code}\n\n유효기간: ${expireDate}까지\n발급하기: https://www.guamsavecard.com/register`,
                            type: 'LMS'
                        }
                    }
                ]
            };

            const response = await axios.post(
                `${this.baseURL}/api/comm/v1/send/omni`,
                requestBody,
                { headers: this.getHeaders() }
            );

            console.log('✅ 알림톡 전송 성공:', {
                to: phoneNumber,
                name,
                code,
                result: response.data
            });

            return {
                success: true,
                result: response.data,
                message: '알림톡이 전송되었습니다.'
            };

        } catch (error) {
            console.error('❌ 알림톡 전송 실패:', error.response?.data || error.message);
            
            // 에러 메시지 정리
            let errorMessage = '알림톡 전송에 실패했습니다.';
            if (error.response?.data) {
                // 비즈고 API 에러 응답 처리
                const errorData = error.response.data;
                if (errorData.message) {
                    errorMessage += ` (${errorData.message})`;
                } else if (errorData.error) {
                    errorMessage += ` (${errorData.error})`;
                } else {
                    errorMessage += ` (상태: ${error.response.status})`;
                }
            } else if (error.message) {
                errorMessage += ` (${error.message})`;
            }
            
            return {
                success: false,
                error: error.response?.data || error.message,
                message: errorMessage
            };
        }
    }

    /**
     * 바우처 알림톡 전송 (VOUCHER_001 템플릿)
     * @param {Object} params - 전송 파라미터
     * @param {string} params.to - 수신자 전화번호 (01012345678)
     * @param {string} params.name - 예약자명
     * @param {string} params.platformName - 예약업체명 (NOL, KLOOK 등)
     * @param {string} params.productName - 상품명
     * @param {string} params.usageDate - 이용일 (YYYY-MM-DD)
     * @param {string} params.voucherToken - 바우처 토큰
     */
    async sendVoucherAlimtalk({ to, name, platformName, productName, usageDate, voucherToken }) {
        try {
            // 전화번호 포맷 정리 (하이픈 제거)
            const phoneNumber = to.replace(/[^0-9]/g, '');

            // 비즈고 API 정확한 요청 형식 (템플릿 변수 그대로 + replaceWords)
            const requestBody = {
                messageFlow: [
                    {
                        alimtalk: {
                            senderKey: this.senderKey,  // 카카오 발신프로필키
                            msgType: 'AL',  // 알림톡 텍스트 (AL: 알림톡, AI: 알림톡 이미지)
                            templateCode: 'VOUCHER_001',  // 템플릿 코드
                            // 템플릿 원본 그대로 (#{변수명} 형식)
                            text: `[#{PRODUCT_NAME} 바우처]\n\n안녕하세요, #{NAME}님\n\n#{PLATFORM_NAME}에서 예약하신 상품의 바우처가 발급되었습니다.\n\n▶ 상품명: #{PRODUCT_NAME}\n▶ 이용일: #{USAGE_DATE}\n\n아래 버튼을 눌러 바우처와 이용시 안내사항을 꼭 확인하세요.`,
                            button: [
                                {
                                    type: 'WL',
                                    name: '바우처보기',
                                    // 버튼 URL도 #{변수명} 형식
                                    urlMobile: `https://www.guamsavecard.com/voucher/#{TOKEN}`,
                                    urlPc: `https://www.guamsavecard.com/voucher/#{TOKEN}`
                                }
                            ]
                        }
                    }
                ],
                destinations: [
                    {
                        to: phoneNumber,
                        ref: voucherToken,  // 추적용 참조값 (바우처 토큰)
                        // 변수 치환 (키는 변수명만, #{} 제외)
                        replaceWords: {
                            'PRODUCT_NAME': productName,
                            'NAME': name,
                            'PLATFORM_NAME': platformName,
                            'USAGE_DATE': usageDate,
                            'TOKEN': voucherToken
                        },
                        // 알림톡 실패 시 자동 SMS 발송
                        fallback: {
                            from: this.senderPhone,
                            text: `[괌세이브카드 바우처]\n\n${name}님, ${productName} 바우처가 발급되었습니다.\n\n이용일: ${usageDate}\n바우처 확인: https://www.guamsavecard.com/voucher/${voucherToken}`,
                            type: 'LMS'  // 긴 문자는 LMS
                        }
                    }
                ]
            };

            // 요청 데이터 로그
            console.log('📤 비즈고 API 요청:', JSON.stringify(requestBody, null, 2));
            
            const response = await axios.post(
                `${this.baseURL}/api/comm/v1/send/omni`,
                requestBody,
                { headers: this.getHeaders() }
            );

            console.log('✅ 바우처 알림톡 전송 성공:', {
                to: phoneNumber,
                name,
                platformName,
                productName,
                usageDate,
                voucherToken
            });
            
            // 응답 데이터 상세 로그
            console.log('📋 API 응답 상세:', JSON.stringify(response.data, null, 2));

            return {
                success: true,
                result: response.data,
                message: '바우처 알림톡이 전송되었습니다.'
            };

        } catch (error) {
            console.error('❌ 바우처 알림톡 전송 실패:', error.response?.data || error.message);
            
            // 에러 메시지 정리
            let errorMessage = '바우처 알림톡 전송에 실패했습니다.';
            if (error.response?.data) {
                // 비즈고 API 에러 응답 처리
                const errorData = error.response.data;
                if (errorData.message) {
                    errorMessage += ` (${errorData.message})`;
                } else if (errorData.error) {
                    errorMessage += ` (${errorData.error})`;
                } else {
                    errorMessage += ` (상태: ${error.response.status})`;
                }
            } else if (error.message) {
                errorMessage += ` (${error.message})`;
            }
            
            return {
                success: false,
                error: error.response?.data || error.message,
                message: errorMessage
            };
        }
    }

    /**
     * SMS 대체 발송 (알림톡 실패 시)
     */
    async sendSMS({ to, text }) {
        try {
            const phoneNumber = to.replace(/[^0-9]/g, '');

            // 비즈고 API 요청 (SMS)
            const requestBody = {
                message_type: 'SMS',
                phn: phoneNumber,
                callback: this.senderPhone,
                msg: text
            };

            const response = await axios.post(
                `${this.baseURL}/api/comm/send`,
                requestBody,
                { headers: this.getHeaders() }
            );

            console.log('✅ SMS 전송 성공:', {
                to: phoneNumber,
                result: response.data
            });

            return {
                success: true,
                result: response.data
            };

        } catch (error) {
            console.error('❌ SMS 전송 실패:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data || error.message
            };
        }
    }
}

// 싱글톤 인스턴스
const bizonService = new BizonService();

module.exports = bizonService;
