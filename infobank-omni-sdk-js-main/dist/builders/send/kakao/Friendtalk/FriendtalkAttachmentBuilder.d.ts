import { Attachment, Commerce, Coupon, Image, Item, Video } from "../../../../interfaces/send/kakao/Friendtalk/Friendtalk";
import { KakaoButton } from "../../../../interfaces/send/kakao/KakaoButton";
export declare class FriendtalkAttachmentBuilder {
    private attachment;
    /** 버튼 목록
        msgType이 FT, FI이고 coupon을 적용할 경우 최대 4개 그 외 최대 5개  */
    setButton(button?: KakaoButton[]): this;
    /** 이미지 msgType이 FM인 경우 필수  */
    setImage(image?: Image): this;
    /** 와이드 리스트 요소  */
    setItem(item?: Item): this;
    /** 쿠폰 요소 메세지 최하단 노출  */
    setCoupon(coupon?: Coupon): this;
    /** 커머스 요소  */
    setCommerce(commerce?: Commerce): this;
    /** 비디오 요소  */
    setVideo(video?: Video): this;
    build(): Attachment;
}
