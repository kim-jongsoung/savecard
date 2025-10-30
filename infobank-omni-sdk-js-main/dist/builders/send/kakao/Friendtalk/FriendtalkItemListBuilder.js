export class FriendtalkItemListBuilder {
    constructor() {
        this.itemList = {};
    }
    /** 아이템 제목 */
    setTitle(title) {
        this.itemList.title = title;
        return this;
    }
    /** 아이템 이미지 URL */
    setImgUrl(imgUrl) {
        this.itemList.imgUrl = imgUrl;
        return this;
    }
    /** mobile android 환경에서 이미지 클릭 시 실행할 application custom scheme */
    setSchemeAndroid(schemeAndroid) {
        this.itemList.schemeAndroid = schemeAndroid;
        return this;
    }
    /** mobile ios 환경에서 이미지 클릭 시 실행할 application custom scheme */
    setSchemeIos(schemeIos) {
        this.itemList.schemeIos = schemeIos;
        return this;
    }
    /** mobile 환경에서 이미지 클릭 시 이동할 url */
    setUrlMobile(urlMobile) {
        this.itemList.urlMobile = urlMobile;
        return this;
    }
    /** pc 환경에서 이미지 클릭 시 이동할 url */
    setUrlPc(urlPc) {
        this.itemList.urlPc = urlPc;
        return this;
    }
    build() {
        return this.itemList;
    }
}
