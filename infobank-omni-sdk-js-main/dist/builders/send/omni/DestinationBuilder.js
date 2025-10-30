export class DestinationBuilder {
    constructor() {
        this.destination = {};
    }
    /** 수신번호 설정 */
    setTo(to) {
        this.destination.to = to;
        return this;
    }
    /** 치환 문구 설정 (JSON) */
    setReplaceWords(replaceWords) {
        this.destination.replaceWords = replaceWords;
        return this;
    }
    /** Destinations 객체 생성 */
    build() {
        return this.destination;
    }
}
