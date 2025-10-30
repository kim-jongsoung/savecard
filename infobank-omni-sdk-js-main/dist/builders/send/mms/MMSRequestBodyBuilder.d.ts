import { MMSRequestBody } from "../../../interfaces/send/mms/MMSRequestBody";
/**
 * 클래스: MMSRequestBodyBuilder
 * 설명: MMS(LMS) 발송을 위한 MMSRequestBody 빌더 클래스입니다.
 */
export declare class MMSRequestBodyBuilder {
    private mmsRequestBody;
    constructor();
    /** 발신번호 설정 */
    setFrom(from: string): this;
    /** 수신번호 설정 */
    setTo(to: string): this;
    /** 메시지 내용 설정 (최대 2000 바이트) */
    setText(text: string): this;
    /** 메시지 제목 설정 (선택 사항, 최대 40 바이트) */
    setTitle(title?: string): this;
    /** 파일 키 설정 (선택 사항, 최대 3개) */
    setFileKey(fileKey?: string[]): this;
    /** 참조필드 설정 (선택 사항, 최대 200 바이트) */
    setRef(ref?: string): this;
    /** 최초 발신사업자 식별코드 설정 (선택 사항, 최대 9 바이트) */
    setOriginCID(originCID?: string): this;
    build(): MMSRequestBody;
}
