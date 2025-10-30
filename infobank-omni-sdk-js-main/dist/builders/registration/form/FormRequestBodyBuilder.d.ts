import { FormRequestBody } from "../../../interfaces/registration/form/FormRequestBody";
import { MessageForm } from "../../../interfaces/registration/form/MessageForm";
/**
 * 클래스: FormRequestBodyBuilder
 * 설명: FORM 등록/수정을 위한 FormRequestBody 빌더 클래스입니다.
 */
export declare class FormRequestBodyBuilder {
    private formRequestBody;
    /** 메시지 form 세부 사항 설정 (선택 사항) */
    setMessageForm(messageForm?: MessageForm[]): this;
    /** FormRequestBody 객체 생성 */
    build(): FormRequestBody;
}
