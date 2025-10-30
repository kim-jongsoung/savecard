import { RCSContent } from "../../../interfaces/send/rcs/RCSContent";
import { RCSRequestBody } from "../../../interfaces/send/rcs/RCSRequestBody";
import { FallbackMessage } from "../../../interfaces/send/FallbackMessage";
/**
 * 클래스: RCSRequestBodyBuilder
 * 설명: RCSRequestBody 객체 생성을 위한 빌더 클래스입니다.
 */
export declare class RCSRequestBodyBuilder {
    private rcsRequestBody;
    /** RCS 메시지 JSON 객체 설정 */
    setContent(content: RCSContent): this;
    /** 발신번호 설정 */
    setFrom(from: string): this;
    /** 수신번호 설정 */
    setTo(to: string): this;
    /** RCS 메시지 formatID 설정 */
    setFormatId(formatId: string): this;
    /** Body 설정 */
    setBody(body: object): this;
    /** Buttons 설정 */
    setButtons(buttons: object[]): this;
    /** RCS 브랜드 키 설정 */
    setBrandKey(brandKey: string): this;
    /** RCS 브랜드 ID 설정 (선택 사항) */
    setBrandId(brandId?: string): this;
    /** 전송 시간 초과 설정 (선택 사항) */
    setExpiryOption(expiryOption?: string): this;
    /** 메시지 상단 ‘광고’ 표출 여부 설정 (선택 사항) */
    setHeader(header?: string): this;
    /** 메시지 하단 수신거부 번호 설정 (선택 사항) */
    setFooter(footer?: string): this;
    /** 참조필드 설정 (선택 사항, 최대 200 바이트) */
    setRef(ref?: string): this;
    /** 실패 시 전송될 Fallback 메시지 설정 (선택 사항) */
    setFallback(fallback?: FallbackMessage): this;
    /** RCSRequestBody 객체 생성 */
    build(): RCSRequestBody;
}
