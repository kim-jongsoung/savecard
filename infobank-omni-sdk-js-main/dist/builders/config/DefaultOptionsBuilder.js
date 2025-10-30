/**
 * 클래스: DefaultOptionsBuilder
 * 설명: OMNI API 사용을 위한 DefaultOption 빌더 클래스입니다.
 */
export class DefaultOptionsBuilder {
    constructor() {
        this.defaultOptions = {};
    }
    setBaseURL(baseURL) {
        this.defaultOptions.baseURL = baseURL;
        return this;
    }
    setToken(token) {
        this.defaultOptions.token = token;
        return this;
    }
    build() {
        return this.defaultOptions;
    }
}
