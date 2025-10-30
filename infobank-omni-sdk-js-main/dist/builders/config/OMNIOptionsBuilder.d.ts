import { OMNIOptions } from "../../interfaces/config/Config";
/**
 * 클래스: OMNIOptionsBuilder
 * 설명: OMNI API 인증 및 사용을 위한 OMNIOption 빌더 클래스입니다.
 */
export declare class OMNIOptionsBuilder {
    private omniOptions;
    setBaseURL(baseURL: string): this;
    setId(id?: string): this;
    setPassword(password?: string): this;
    setToken(token?: string): this;
    build(): OMNIOptions;
}
