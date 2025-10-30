/**
 * 클래스: ComTButtonBuilder
 * 설명: 대화방 열기 (음성, 영상) 메시지 App을 실행합니다. (COM_V)
 */
export class ComVButtonBuilder {
    constructor() {
        this.button = { type: 'COM_V' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 대화방의 수신자 번호 */
    setPhoneNumber(phoneNumber) {
        this.button.phoneNumber = phoneNumber;
        return this;
    }
    build() {
        return this.button;
    }
}
