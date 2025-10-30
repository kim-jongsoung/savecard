/**
 * 클래스: OMNIOptionsBuilder
 * 설명: OMNI API 인증 및 사용을 위한 OMNIOption 빌더 클래스입니다.
 */
export class OMNIOptionsBuilder {
    constructor() {
        this.omniOptions = {};
    }
    setBaseURL(baseURL) {
        this.omniOptions.baseURL = baseURL;
        return this;
    }
    setId(id) {
        this.omniOptions.id = id;
        return this;
    }
    setPassword(password) {
        this.omniOptions.password = password;
        return this;
    }
    setToken(token) {
        this.omniOptions.token = token;
        return this;
    }
    build() {
        return this.omniOptions;
    }
}
