export class OMNIRequestBodyBuilder {
    constructor() {
        this.omniRequestBody = {};
    }
    /** 수신 정보 리스트 설정 (최대 10개) */
    setDestinations(destinations) {
        this.omniRequestBody.destinations = destinations;
        return this;
    }
    /** 메시지 정보 리스트 설정 */
    setMessageFlow(messageFlow) {
        this.omniRequestBody.messageFlow = messageFlow;
        return this;
    }
    /** 메시지 폼 ID 설정 */
    setMessageForm(messageForm) {
        this.omniRequestBody.messageForm = messageForm;
        return this;
    }
    /** 정산용 부서코드 설정 (최대 20자) */
    setPaymentCode(paymentCode) {
        this.omniRequestBody.paymentCode = paymentCode;
        return this;
    }
    /** 참조 필드 설정 (선택 사항) */
    setRef(ref) {
        this.omniRequestBody.ref = ref;
        return this;
    }
    /** OMNIRequestBody 객체 생성 */
    build() {
        return this.omniRequestBody;
    }
}
