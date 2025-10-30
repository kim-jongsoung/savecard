import { FallbackMessage } from "../../../../interfaces/send/FallbackMessage";
import { AlimtalkRequestBody } from "../../../../interfaces/send/kakao/Alimtalk/AlimtalkRequestBody";
import { KakaoButton } from "../../../../interfaces/send/kakao/KakaoButton";
export declare class AlimtalkRequestBodyBuilder {
    private alimtalkRequestBody;
    /** 카카오 비즈메시지 발신 프로필 키 설정 */
    setSenderKey(senderKey: string): this;
    /** 카카오 알림톡메시지타입 설정 */
    setMsgType(msgType: string): this;
    /** 수신번호 설정 */
    setTo(to: string): this;
    /** 알림톡 템플릿 코드 설정 */
    setTemplateCode(templateCode: string): this;
    /** 알림톡 내용 설정 */
    setText(text: string): this;
    /** 카카오 버튼 정보 설정 (최대 5개) */
    setButton(button?: KakaoButton[]): this;
    /** 참조필드 설정 (최대 200자, 선택 사항) */
    setRef(ref?: string): this;
    /** 실패 시 전송될 Fallback 메시지 정보 설정 (선택 사항) */
    setFallback(fallback?: FallbackMessage): this;
    /** AlimtalkRequestBody 객체 생성 */
    build(): AlimtalkRequestBody;
}
