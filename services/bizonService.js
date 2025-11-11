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
        
        // 초기화 로그 (서버 시작 시 한 번만)
        console.log('🔧 BizonService 초기화:');
        console.log('  - Base URL:', this.baseURL);
        console.log('  - API Key:', this.apiKey ? `${this.apiKey.substring(0, 15)}...` : '❌ 설정되지 않음');
        console.log('  - Sender Key:', this.senderKey ? `${this.senderKey.substring(0, 20)}...` : '❌ 설정되지 않음');
        console.log('  - Sender Phone:', this.senderPhone || '❌ 설정되지 않음');
        
        // 필수 설정 체크
        if (!this.apiKey || !this.senderKey || !this.senderPhone) {
            console.error('❌ 비즈고 설정 오류: 필수 환경변수가 설정되지 않았습니다!');
            console.error('   필요한 환경변수: BIZON_API_KEY, BIZON_SENDER_KEY, BIZON_SENDER_PHONE');
        }
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
     * 발급 코드 알림톡 전송 (SAVECARD_CODE_001 템플릿)
     * @param {Object} params - 전송 파라미터
     * @param {string} params.to - 수신자 전화번호 (01012345678)
     * @param {string} params.name - 고객 이름
     * @param {string} params.code - 발급 코드
     * @param {string} params.expireDate - 유효기간 (사용하지 않음 - 템플릿에 없음)
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
                            msgType: 'AT',  // 알림톡 (비즈고 API: AT)
                            templateCode: 'SAVECARD_CODE_001',  // 템플릿 코드
                            // ✅ 치환된 실제 값을 직접 입력 (API 문서 Footnote[5])
                            text: `[괌세이브카드 발급 코드 안내]\n\n안녕하세요, ${name}님!\n**구매하신 괌 즐길거리 상품의 혜택**으로 괌세이브카드 발급 코드를 안내해 드립니다.\n괌세이브카드 발급 절차를 위한 코드를 안내해 드립니다.\n\n**[1단계: 발급 코드]**\n  코드: ${code}\n\n**[2단계: QR 발급]**\n 웹사이트에 접속하여 위 코드를 입력하신 후, 세이브카드 QR을 발급받으세요.\n\n**[3단계: 현지 이용]**\n 괌 현지 매장 이용 시 발급받으신 QR을 제시해 주시면 됩니다.\n\n감사합니다.\n\n- 이 메시지는 구매하신 상품(서비스)의 사은품으로 지급된 쿠폰 안내 메시지입니다.`,
                            button: [
                                {
                                    type: 'WL',
                                    name: '코드등록및발급하기',
                                    urlMobile: 'https://www.guamsavecard.com/register',
                                    urlPc: 'https://www.guamsavecard.com/register'
                                }
                            ]
                        }
                    }
                ],
                destinations: [
                    {
                        to: phoneNumber,
                        ref: code,  // 추적용 참조값 (발급 코드)
                        // ✅ replaceWords 제거 (text에 이미 치환된 값 사용)
                        // 알림톡 실패 시 자동 SMS 발송
                        fallback: {
                            from: this.senderPhone,
                            text: `[괌세이브카드 발급코드]\n\n${name}님, 발급코드: ${code}\n\n발급하기: https://www.guamsavecard.com/register`,
                            type: 'LMS'
                        }
                    }
                ]
            };

            console.log('📤 발급 코드 알림톡 API 요청:', JSON.stringify(requestBody, null, 2));
            console.log('🔑 비즈고 설정 (전체):');
            console.log('  - Base URL:', this.baseURL);
            console.log('  - API Key (전체):', this.apiKey);
            console.log('  - Sender Key (전체):', this.senderKey);
            console.log('  - Sender Phone:', this.senderPhone);
            console.log('  - 요청 URL:', `${this.baseURL}/api/comm/v1/send/omni`);

            const response = await axios.post(
                `${this.baseURL}/api/comm/v1/send/omni`,
                requestBody,
                { headers: this.getHeaders() }
            );

            console.log('✅ 발급 코드 알림톡 전송 성공:', {
                to: phoneNumber,
                name,
                code
            });
            console.log('📋 API 응답 상세:', JSON.stringify(response.data, null, 2));

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

            // 비즈고 API 요청 형식 (API 문서 Footnote[5]: 치환된 전체 내용 입력)
            const requestBody = {
                messageFlow: [
                    {
                        alimtalk: {
                            senderKey: this.senderKey,  // 카카오 발신프로필키
                            msgType: 'AT',  // 알림톡 (비즈고 API: AT)
                            templateCode: 'VOUCHER_001',  // 템플릿 코드
                            // ✅ 치환된 실제 값을 직접 입력 (#{변수} 아님!)
                            text: `[${productName} 바우처]\n\n안녕하세요, ${name}님\n\n${platformName}에서 예약하신 상품의 바우처가 발급되었습니다.\n\n▶ 상품명: ${productName}\n▶ 이용일: ${usageDate}\n\n아래 버튼을 눌러 바우처와 이용시 안내사항을 꼭 확인하세요.`,
                            button: [
                                {
                                    type: 'WL',
                                    name: '바우처보기',
                                    // ✅ 버튼 URL도 실제 값 사용
                                    urlMobile: `https://www.guamsavecard.com/voucher/${voucherToken}`,
                                    urlPc: `https://www.guamsavecard.com/voucher/${voucherToken}`
                                }
                            ]
                        }
                    }
                ],
                destinations: [
                    {
                        to: phoneNumber,
                        ref: voucherToken,  // 추적용 참조값 (바우처 토큰)
                        // ✅ replaceWords 제거 (text에 이미 치환된 값 사용)
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
     * 템플릿 조회 (디버깅용)
     * @param {string} templateCode - 템플릿 코드 (예: SAVECARD_CODE_001)
     */
    async getTemplate(templateCode) {
        try {
            const url = `${this.baseURL}/api/comm/v1/center/alimtalk/template?senderKey=${this.senderKey}&templateCode=${templateCode}`;
            
            console.log('🔍 템플릿 조회 요청:', { templateCode, senderKey: this.senderKey });
            
            const response = await axios.get(url, {
                headers: this.getHeaders()
            });

            console.log('✅ 템플릿 조회 성공:', JSON.stringify(response.data, null, 2));

            return {
                success: true,
                data: response.data
            };

        } catch (error) {
            console.error('❌ 템플릿 조회 실패:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data || error.message
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
