/**
 * 클래스: SMSBuilder
 * 설명: OMNI 통합 발송과 FORM 등록/수정을 위한 SMS 빌더 클래스입니다.
 */
export class SMSBuilder {
    constructor() {
        this.sms = {};
    }
    /** 발신번호 설정 */
    setFrom(from) {
        this.sms.from = from;
        return this;
    }
    /** SMS 메시지 내용 설정 (최대 90바이트) */
    setText(text) {
        this.sms.text = text;
        return this;
    }
    /** 메시지 유효 시간 설정 (초), 기본값: 86400 */
    setTtl(ttl) {
        this.sms.ttl = ttl;
        return this;
    }
    /** 최초 발신사업자 식별코드 설정 (최대 길이 9) */
    setOriginCID(originCID) {
        this.sms.originCID = originCID;
        return this;
    }
    /** SMS 객체 생성 */
    build() {
        return this.sms;
    }
}
