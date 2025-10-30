import { DialButton } from "../../../interfaces/send/rcs/RCSContent";
/**
 * 클래스: DialButtonBuilder
 * 설명: 	특정 전화번호로 전화를 걸 수 있습니다. (DIAL)
 */
export declare class DialButtonBuilder {
    private button;
    /** 버튼 명 */
    setName(name: string): this;
    /** 전화 연결 할 수신자 번호 */
    setPhoneNumber(phoneNumber: string): this;
    build(): DialButton;
}
