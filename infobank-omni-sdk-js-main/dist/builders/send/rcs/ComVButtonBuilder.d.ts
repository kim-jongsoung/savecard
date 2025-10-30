import { ComVButton } from "../../../interfaces/send/rcs/RCSContent";
/**
 * 클래스: ComTButtonBuilder
 * 설명: 대화방 열기 (음성, 영상) 메시지 App을 실행합니다. (COM_V)
 */
export declare class ComVButtonBuilder {
    private button;
    /** 버튼 명 */
    setName(name: string): this;
    /** 대화방의 수신자 번호 */
    setPhoneNumber(phoneNumber: string): this;
    build(): ComVButton;
}
