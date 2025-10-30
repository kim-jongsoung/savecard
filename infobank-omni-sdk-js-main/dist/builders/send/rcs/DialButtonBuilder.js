/**
 * 클래스: DialButtonBuilder
 * 설명: 	특정 전화번호로 전화를 걸 수 있습니다. (DIAL)
 */
export class DialButtonBuilder {
    constructor() {
        this.button = { type: 'DIAL' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 전화 연결 할 수신자 번호 */
    setPhoneNumber(phoneNumber) {
        this.button.phoneNumber = phoneNumber;
        return this;
    }
    build() {
        return this.button;
    }
}
