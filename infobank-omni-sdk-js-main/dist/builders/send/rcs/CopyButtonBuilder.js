/**
 * 클래스: CopyButtonBuilder
 * 설명: 지정된 내용을 클립보드로 복사합니다. (COPY)
 */
export class CopyButtonBuilder {
    constructor() {
        this.button = { type: 'COPY' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 클립보드로 복사될 내용 */
    setText(text) {
        this.button.text = text;
        return this;
    }
    build() {
        return this.button;
    }
}
