export class KakaoButtonBuilder {
    constructor() {
        this.kakaoButton = {};
    }
    /** 카카오 버튼 종류 설정 */
    setType(type) {
        this.kakaoButton.type = type;
        return this;
    }
    /** 카카오 버튼 명 설정 */
    setName(name) {
        this.kakaoButton.name = name;
        return this;
    }
    /** PC 환경에서 버튼 클릭 시 이동할 URL 설정 */
    setUrlPc(urlPc) {
        this.kakaoButton.urlPc = urlPc;
        return this;
    }
    /** 모바일 환경에서 버튼 클릭 시 이동할 URL 설정 */
    setUrlMobile(urlMobile) {
        this.kakaoButton.urlMobile = urlMobile;
        return this;
    }
    /** iOS 환경에서 버튼 클릭 시 실행할 application custom scheme 설정 */
    setSchemeIos(schemeIos) {
        this.kakaoButton.schemeIos = schemeIos;
        return this;
    }
    /** Android 환경에서 버튼 클릭 시 실행할 application custom scheme 설정 */
    setSchemeAndroid(schemeAndroid) {
        this.kakaoButton.schemeAndroid = schemeAndroid;
        return this;
    }
    /** 버튼 type이 WL(웹 링크)일 경우 아웃링크 사용 설정 */
    setTarget(target) {
        this.kakaoButton.target = target;
        return this;
    }
    /** KakaoButton 객체 생성 */
    build() {
        return this.kakaoButton;
    }
}
