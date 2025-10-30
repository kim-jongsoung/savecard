/**
 * 클래스: FormRequestBodyBuilder
 * 설명: FORM 등록/수정을 위한 FormRequestBody 빌더 클래스입니다.
 */
export class FormRequestBodyBuilder {
    constructor() {
        this.formRequestBody = {};
    }
    /** 메시지 form 세부 사항 설정 (선택 사항) */
    setMessageForm(messageForm) {
        this.formRequestBody.messageForm = messageForm;
        return this;
    }
    /** FormRequestBody 객체 생성 */
    build() {
        return this.formRequestBody;
    }
}
