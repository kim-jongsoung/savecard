/**
 * 클래스: URLButtonBuilder
 * 설명: Web page 또는 App으로 이동할 수 있습니다. (URL)
 */
export class URLButtonBuilder {
    constructor() {
        this.button = { type: 'URL' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 웹브라우저로 연결할 URL주소 */
    setUrl(url) {
        this.button.url = url;
        return this;
    }
    build() {
        return this.button;
    }
}
