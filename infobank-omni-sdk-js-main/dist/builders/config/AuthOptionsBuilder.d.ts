import { AuthOptions } from "../../interfaces/config/Config";
/**
 * 클래스: AuthOptionsBuilder
 * 설명: OMNI API 인증을 위한 AuthOption 빌더 클래스입니다.
 */
export declare class AuthOptionsBuilder {
    private authOptions;
    /** */
    setBaseURL(baseURL: string): this;
    setId(id?: string): this;
    setPassword(password?: string): this;
    build(): AuthOptions;
}
