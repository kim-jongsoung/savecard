import { Destination } from "../../../interfaces/send/omni/Destination";
import { MessageFlow } from "../../../interfaces/send/omni/MessageFlow";
import { OMNIRequestBody } from "../../../interfaces/send/omni/OMNIRequestBody";
export declare class OMNIRequestBodyBuilder {
    private omniRequestBody;
    /** 수신 정보 리스트 설정 (최대 10개) */
    setDestinations(destinations: Array<Destination>): this;
    /** 메시지 정보 리스트 설정 */
    setMessageFlow(messageFlow?: MessageFlow[]): this;
    /** 메시지 폼 ID 설정 */
    setMessageForm(messageForm?: string): this;
    /** 정산용 부서코드 설정 (최대 20자) */
    setPaymentCode(paymentCode?: string): this;
    /** 참조 필드 설정 (선택 사항) */
    setRef(ref?: string): this;
    /** OMNIRequestBody 객체 생성 */
    build(): OMNIRequestBody;
}
