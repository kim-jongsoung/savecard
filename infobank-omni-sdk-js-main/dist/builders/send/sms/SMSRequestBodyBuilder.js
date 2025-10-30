/**
 * 클래스: SMSRequestBodyBuilder
 * 설명: 국내 문자 발송을 위한 SMSRequestBody 빌더 클래스입니다.
 */
export class SMSRequestBodyBuilder {
    constructor() {
        this.smsRequestBody = {
            from: '',
            to: '',
            text: '',
        };
    }
    /** 발신번호 설정 */
    setFrom(from) {
        this.smsRequestBody.from = from;
        return this;
    }
    /** 수신번호 설정 */
    setTo(to) {
        this.smsRequestBody.to = to;
        return this;
    }
    /** 메시지 내용 설정 (최대 90자) */
    setText(text) {
        this.smsRequestBody.text = text;
        return this;
    }
    /** 참조필드 설정 (선택 사항, 최대 200자) */
    setRef(ref) {
        this.smsRequestBody.ref = ref;
        return this;
    }
    /** 최초 발신사업자 식별코드 설정 (선택 사항, 최대 9자) */
    setOriginCID(originCID) {
        this.smsRequestBody.originCID = originCID;
        return this;
    }
    /** SMSRequestBody 객체 생성 */
    build() {
        return this.smsRequestBody;
    }
}
