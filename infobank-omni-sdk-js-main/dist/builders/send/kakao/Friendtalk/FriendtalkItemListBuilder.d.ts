import { ItemList } from "../../../../interfaces/send/kakao/Friendtalk/Friendtalk";
export declare class FriendtalkItemListBuilder {
    private itemList;
    /** 아이템 제목 */
    setTitle(title: string): this;
    /** 아이템 이미지 URL */
    setImgUrl(imgUrl: string): this;
    /** mobile android 환경에서 이미지 클릭 시 실행할 application custom scheme */
    setSchemeAndroid(schemeAndroid?: string): this;
    /** mobile ios 환경에서 이미지 클릭 시 실행할 application custom scheme */
    setSchemeIos(schemeIos?: string): this;
    /** mobile 환경에서 이미지 클릭 시 이동할 url */
    setUrlMobile(urlMobile: string): this;
    /** pc 환경에서 이미지 클릭 시 이동할 url */
    setUrlPc(urlPc: string): this;
    build(): ItemList;
}
