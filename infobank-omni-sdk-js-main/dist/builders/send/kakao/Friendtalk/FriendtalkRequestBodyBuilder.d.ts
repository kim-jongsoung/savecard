import { FallbackMessage } from "../../../../interfaces/send/FallbackMessage";
import { FriendtalkRequestBody } from "../../../../interfaces/send/kakao/Friendtalk/FriendtalkRequestBody";
import { KakaoButton } from "../../../../interfaces/send/kakao/KakaoButton";
export declare class FriendtalkRequestBodyBuilder {
    private friendtalkRequestBody;
    /** 카카오 비즈메시지 발신 프로필 키 설정 */
    setSenderKey(senderKey: string): this;
    /** 카카오 친구톡 메시지타입 설정 */
    setMsgType(msgType: string): this;
    /** 수신번호 설정 */
    setTo(to: string): this;
    /** 친구톡 내용 설정 (최대 90자) */
    setText(text: string): this;
    /** 친구톡 이미지 URL 설정 */
    setImgUrl(imgUrl?: string): this;
    /** 친구톡 버튼정보 설정 */
    setButton(button?: KakaoButton[]): this;
    /** 참조필드 설정 (최대 200자) */
    setRef(ref?: string): this;
    /** 실패 시 전송될 Fallback 메시지 정보 설정 */
    setFallback(fallback?: FallbackMessage): this;
    /** FriendtalkRequestBody 객체 생성 */
    build(): FriendtalkRequestBody;
}
