import { FallbackMessage } from "../../interfaces/send/FallbackMessage";
/**
 * 클래스: SMSRequestBodyBuilder
 * 설명: SMSRequestBody 객체 생성을 위한 빌더 클래스입니다.
 */
export declare class FallbackBuilder {
    private fallback;
    setType(type: string): this;
    setFrom(type: string): this;
    setText(text: string): this;
    setTitle(title?: string): this;
    setFileKey(fileKey?: string[]): this;
    setOriginCID(originCID?: string): this;
    build(): FallbackMessage;
}
