/**
 * 클래스: FriendtalkCarouselHeadBuilder
 * 설명: 카카오 비즈메시지 친구톡 캐로셀의 헤더 정보를 나타냅니다.
 */
export class FriendtalkCarouselHeadBuilder {
    constructor() {
        this.head = {};
    }
    /** 캐로셀 인트로 헤더 (최대 20자) */
    setHeader(header) {
        this.head.header = header;
        return this;
    }
    /** 캐로셀 인트로 내용 (최대 50자) */
    setContent(content) {
        this.head.content = content;
        return this;
    }
    /** 캐로셀 인트로 이미지 주소 */
    setImageUrl(imageUrl) {
        this.head.imageUrl = imageUrl;
        return this;
    }
    /** 모바일 환경에서 인트로 클릭 시 이동할 URL (URL 필드 중 하나라도 값이 있으면 필수) */
    setUrlMobile(urlMobile) {
        this.head.urlMobile = urlMobile;
        return this;
    }
    /** PC 환경에서 인트로 클릭 시 이동할 URL */
    setUrlPc(urlPc) {
        this.head.urlPc = urlPc;
        return this;
    }
    /** 모바일 Android 환경에서 인트로 클릭 시 실행할 application custom scheme */
    setSchemeAndroid(schemeAndroid) {
        this.head.schemeAndroid = schemeAndroid;
        return this;
    }
    /** 모바일 iOS 환경에서 인트로 클릭 시 실행할 application custom scheme */
    setSchemeIos(schemeIos) {
        this.head.schemeIos = schemeIos;
        return this;
    }
    build() {
        return this.head;
    }
}
