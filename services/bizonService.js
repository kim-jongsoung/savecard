/**
 * 비즈온 알림톡 발송 서비스
 * infobank OMNI SDK를 사용하여 카카오 알림톡 전송
 */

const { OMNI, OMNIOptionsBuilder, AlimtalkBuilder } = require('omni-sdk-js');

class BizonService {
    constructor() {
        this.baseURL = process.env.BIZON_BASE_URL;
        this.userId = process.env.BIZON_USER_ID;
        this.userPassword = process.env.BIZON_USER_PASSWORD;
        this.senderKey = process.env.BIZON_SENDER_KEY;
        this.templateCode = process.env.BIZON_TEMPLATE_CODE;
        this.senderPhone = process.env.BIZON_SENDER_PHONE;
        
        this.omni = null;
        this.token = null;
    }

    /**
     * 토큰 발급 및 OMNI 인스턴스 초기화
     */
    async initialize() {
        try {
            const option = new OMNIOptionsBuilder()
                .setBaseURL(this.baseURL)
                .setId(this.userId)
                .setPassword(this.userPassword)
                .build();
            
            this.omni = new OMNI(option);
            this.token = await this.omni.auth.getToken();
            
            console.log('✅ 비즈온 API 인증 성공');
            return true;
        } catch (error) {
            console.error('❌ 비즈온 API 인증 실패:', error);
            throw error;
        }
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
            // 토큰이 없으면 초기화
            if (!this.token) {
                await this.initialize();
            }

            // 전화번호 포맷 정리 (하이픈 제거)
            const phoneNumber = to.replace(/[^0-9]/g, '');

            // 메시지 내용 구성
            const messageText = `[괌세이브카드] 발급코드 안내

안녕하세요, ${name}님!
괌세이브카드 발급코드를 안내드립니다.

━━━━━━━━━━━━━━━━━━
📌 발급코드: ${code}
━━━━━━━━━━━━━━━━━━

위 코드로 괌세이브카드를 발급받으실 수 있습니다.

※ 발급코드는 1회만 사용 가능합니다.
※ 발급 유효기간: ${expireDate}까지

문의사항이 있으시면 언제든 연락주세요.
감사합니다.`;

            // 알림톡 요청 구성
            const req = {
                to: phoneNumber,
                from: this.senderPhone,
                alimtalk: {
                    msgType: "AT",
                    senderKey: this.senderKey,
                    templateCode: this.templateCode,
                    text: messageText,
                    buttons: [
                        {
                            type: "WL",
                            name: "카드 발급하기",
                            url_mobile: "https://www.guamsavecard.com/register",
                            url_pc: "https://www.guamsavecard.com/register"
                        },
                        {
                            type: "WL",
                            name: "가맹점 보기",
                            url_mobile: "https://www.guamsavecard.com/stores",
                            url_pc: "https://www.guamsavecard.com/stores"
                        }
                    ]
                }
            };

            // 알림톡 전송
            const result = await this.omni.send.Alimtalk(req);

            console.log('✅ 알림톡 전송 성공:', {
                to: phoneNumber,
                name,
                code,
                result
            });

            return {
                success: true,
                result,
                message: '알림톡이 전송되었습니다.'
            };

        } catch (error) {
            console.error('❌ 알림톡 전송 실패:', error);
            
            return {
                success: false,
                error: error.message,
                message: '알림톡 전송에 실패했습니다.'
            };
        }
    }

    /**
     * SMS 대체 발송 (알림톡 실패 시)
     */
    async sendSMS({ to, text }) {
        try {
            if (!this.token) {
                await this.initialize();
            }

            const phoneNumber = to.replace(/[^0-9]/g, '');

            const req = {
                to: phoneNumber,
                from: this.senderPhone,
                text: text
            };

            const result = await this.omni.send.SMS(req);

            console.log('✅ SMS 전송 성공:', {
                to: phoneNumber,
                result
            });

            return {
                success: true,
                result
            };

        } catch (error) {
            console.error('❌ SMS 전송 실패:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// 싱글톤 인스턴스
const bizonService = new BizonService();

module.exports = bizonService;
