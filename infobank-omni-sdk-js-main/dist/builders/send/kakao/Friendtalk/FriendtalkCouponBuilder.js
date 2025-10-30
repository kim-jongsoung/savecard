export class FriendtalkCouponBuilder {
    constructor() {
        this.coupon = {};
    }
    /** 와이드 리스트(최소:3, 최대:4)
        쿠폰 이름
        지원하는 형식
        - ${숫자}원 할인 쿠폰 (숫자: 1 ~ 99,999,999)
        - ${숫자}% 할인 쿠폰 (숫자: 1 ~ 100)
        - 배송비 할인 쿠폰
        - ${7자 이내} 무료 쿠폰
        - ${7자 이내} UP 쿠폰*/
    setTitle(title) {
        this.coupon.title = title;
        return this;
    }
    /** 쿠폰 상세 설명 chat_bubble_type이
        WIDE, WIDE_ITEM_LIST, PREMIUM_VIDEO 인 경우
        18자 제한 그 외 12자 제한 */
    setDescription(description) {
        this.coupon.description = description;
        return this;
    }
    /** pc 환경에서 쿠폰 클릭 시 이동할 url */
    setUrlPc(urlPc) {
        this.coupon.urlPc = urlPc;
        return this;
    }
    /** mobile 환경에서 쿠폰 클릭 시 이동할 url */
    setUrlMobile(urlMobile) {
        this.coupon.urlMobile = urlMobile;
        return this;
    }
    /** mobile android 환경에서 쿠폰 클릭 시 실행할 application custom scheme */
    setSchemeAndroid(schemeAndroid) {
        this.coupon.schemeAndroid = schemeAndroid;
        return this;
    }
    /** mobile ios 환경에서 쿠폰 클릭 시 실행할 application custom scheme */
    setSchemeIos(schemeIos) {
        this.coupon.schemeIos = schemeIos;
        return this;
    }
    build() {
        return this.coupon;
    }
}
