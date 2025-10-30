import { DefaultOptions } from "../../interfaces/config/Config";
/**
 * 클래스: DefaultOptionsBuilder
 * 설명: OMNI API 사용을 위한 DefaultOption 빌더 클래스입니다.
 */
export declare class DefaultOptionsBuilder {
    private defaultOptions;
    setBaseURL(baseURL: string): this;
    setToken(token?: string): this;
    build(): DefaultOptions;
}
