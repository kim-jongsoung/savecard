/**
 * 클래스: AuthOptionsBuilder
 * 설명: OMNI API 인증을 위한 AuthOption 빌더 클래스입니다.
 */
export class AuthOptionsBuilder {
    constructor() {
        this.authOptions = {};
    }
    /** */
    setBaseURL(baseURL) {
        this.authOptions.baseURL = baseURL;
        return this;
    }
    setId(id) {
        this.authOptions.id = id;
        return this;
    }
    setPassword(password) {
        this.authOptions.password = password;
        return this;
    }
    build() {
        return this.authOptions;
    }
}
