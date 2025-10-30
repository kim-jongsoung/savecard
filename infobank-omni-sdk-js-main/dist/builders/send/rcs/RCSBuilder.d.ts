import { RCS } from "../../../interfaces/send/rcs/RCS";
import { RCSContent } from "../../../interfaces/send/rcs/RCSContent";
export declare class RCSBuilder {
    private rcs;
    /** 발신번호 설정 */
    setFrom(from: string): this;
    /** RCS 메시지 JSON 객체 설정 */
    setContent(content: RCSContent): this;
    /** RCS 메시지 formatID 설정 */
    setFormatId(formatId: string): this;
    /** Body 설정 */
    setBody(body?: object): this;
    /** Buttons 설정 */
    setButtons(buttons?: object[]): this;
    /** RCS 브랜드 키 설정 */
    setBrandKey(brandKey: string): this;
    /** RCS 브랜드 ID 설정 */
    setBrandId(brandId?: string): this;
    /** RCS 메시지 그룹ID 설정 */
    setGroupId(groupId?: string): this;
    /** 전송 시간 초과 설정 (기본값: 1) */
    setExpiryOption(expiryOption?: string): this;
    /** 메시지 복사 허용 여부 설정 (기본값: 0) */
    setCopyAllowed(copyAllowed?: string): this;
    /** 메시지 상단 ‘광고’ 표출 여부 설정 (기본값: 0) */
    setHeader(header?: string): this;
    /** 메시지 하단 수신거부 번호 설정 */
    setFooter(footer?: string): this;
    /** 대행사ID 설정 (기본값: infobank) */
    setAgencyId(agencyId?: string): this;
    /** 대행사 키 설정 */
    setAgencyKey(agencyKey?: string): this;
    /** 메시지 유효 시간 설정 (초) (기본값: 86400) */
    setTtl(ttl?: string): this;
    /** RCS 객체 생성 */
    build(): RCS;
}
