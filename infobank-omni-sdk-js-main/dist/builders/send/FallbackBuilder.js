/**
 * 클래스: SMSRequestBodyBuilder
 * 설명: SMSRequestBody 객체 생성을 위한 빌더 클래스입니다.
 */
export class FallbackBuilder {
    constructor() {
        this.fallback = {};
    }
    setType(type) {
        this.fallback.type = type;
        return this;
    }
    setFrom(type) {
        this.fallback.from = type;
        return this;
    }
    setText(text) {
        this.fallback.text = text;
        return this;
    }
    setTitle(title) {
        this.fallback.title = title;
        return this;
    }
    setFileKey(fileKey) {
        this.fallback.fileKey = fileKey;
        return this;
    }
    setOriginCID(originCID) {
        this.fallback.originCID = originCID;
        return this;
    }
    build() {
        return this.fallback;
    }
}
