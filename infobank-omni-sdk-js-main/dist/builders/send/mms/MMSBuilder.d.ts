import { MMS } from "../../../interfaces/send/mms/MMS";
/**
 * 클래스: MMSBuilder
 * 설명: OMNI 통합 발송과 FORM 등록/수정을 위한 MMS 빌더 클래스입니다.
 */
export declare class MMSBuilder {
    private mms;
    /** 발신번호 설정 */
    setFrom(from: string): this;
    /** MMS 메시지 내용 설정 (최대 2000바이트) */
    setText(text: string): this;
    /** MMS 메시지 제목 설정 (최대 40바이트) */
    setTitle(title?: string): this;
    /** 파일 키 설정 (최대 3개) */
    setFileKey(fileKey?: string[]): this;
    /** 메시지 유효 시간 설정 (초), 기본값: 86400 */
    setTtl(ttl?: string): this;
    /** 최초 발신사업자 식별코드 설정 (최대 길이 9) */
    setOriginCID(originCID?: string): this;
    /** MMS 객체 생성 */
    build(): MMS;
}
