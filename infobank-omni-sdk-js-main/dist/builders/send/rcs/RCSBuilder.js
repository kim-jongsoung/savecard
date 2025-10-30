export class RCSBuilder {
    constructor() {
        this.rcs = {};
    }
    /** 발신번호 설정 */
    setFrom(from) {
        this.rcs.from = from;
        return this;
    }
    /** RCS 메시지 JSON 객체 설정 */
    setContent(content) {
        this.rcs.content = content;
        return this;
    }
    /** RCS 메시지 formatID 설정 */
    setFormatId(formatId) {
        this.rcs.formatId = formatId;
        return this;
    }
    /** Body 설정 */
    setBody(body) {
        this.rcs.body = body;
        return this;
    }
    /** Buttons 설정 */
    setButtons(buttons) {
        this.rcs.buttons = buttons;
        return this;
    }
    /** RCS 브랜드 키 설정 */
    setBrandKey(brandKey) {
        this.rcs.brandKey = brandKey;
        return this;
    }
    /** RCS 브랜드 ID 설정 */
    setBrandId(brandId) {
        this.rcs.brandId = brandId;
        return this;
    }
    /** RCS 메시지 그룹ID 설정 */
    setGroupId(groupId) {
        this.rcs.groupId = groupId;
        return this;
    }
    /** 전송 시간 초과 설정 (기본값: 1) */
    setExpiryOption(expiryOption) {
        this.rcs.expiryOption = expiryOption;
        return this;
    }
    /** 메시지 복사 허용 여부 설정 (기본값: 0) */
    setCopyAllowed(copyAllowed) {
        this.rcs.copyAllowed = copyAllowed;
        return this;
    }
    /** 메시지 상단 ‘광고’ 표출 여부 설정 (기본값: 0) */
    setHeader(header) {
        this.rcs.header = header;
        return this;
    }
    /** 메시지 하단 수신거부 번호 설정 */
    setFooter(footer) {
        this.rcs.footer = footer;
        return this;
    }
    /** 대행사ID 설정 (기본값: infobank) */
    setAgencyId(agencyId) {
        this.rcs.agencyId = agencyId;
        return this;
    }
    /** 대행사 키 설정 */
    setAgencyKey(agencyKey) {
        this.rcs.agencyKey = agencyKey;
        return this;
    }
    /** 메시지 유효 시간 설정 (초) (기본값: 86400) */
    setTtl(ttl) {
        this.rcs.ttl = ttl;
        return this;
    }
    /** RCS 객체 생성 */
    build() {
        return this.rcs;
    }
}
