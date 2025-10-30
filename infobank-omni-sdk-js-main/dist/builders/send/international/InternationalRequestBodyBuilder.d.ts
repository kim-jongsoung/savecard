import { InternationalRequestBody } from "../../../interfaces/send/international/InternationalRequestBody";
/**
 * 클래스: InternationalRequestBodyBuilder
 * 설명: 국제 문자 발송을 위한 InternationalRequestBody 빌더 클래스입니다.
 */
export declare class InternationalRequestBodyBuilder {
    private internationalRequestBody;
    constructor();
    /** 발신번호 설정 */
    setFrom(from: string): this;
    /** 수신번호 설정 */
    setTo(to: string): this;
    /** 메시지 내용 설정 (최대 90자) */
    setText(text: string): this;
    /** 참조필드 설정 (선택 사항, 최대 200자) */
    setRef(ref?: string): this;
    /** InternationalRequestBody 객체 생성 */
    build(): InternationalRequestBody;
}
