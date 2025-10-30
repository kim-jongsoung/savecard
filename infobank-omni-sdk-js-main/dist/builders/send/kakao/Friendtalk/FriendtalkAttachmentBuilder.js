export class FriendtalkAttachmentBuilder {
    constructor() {
        this.attachment = {};
    }
    /** 버튼 목록
        msgType이 FT, FI이고 coupon을 적용할 경우 최대 4개 그 외 최대 5개  */
    setButton(button) {
        this.attachment.button = button;
        return this;
    }
    /** 이미지 msgType이 FM인 경우 필수  */
    setImage(image) {
        this.attachment.image = image;
        return this;
    }
    /** 와이드 리스트 요소  */
    setItem(item) {
        this.attachment.item = item;
        return this;
    }
    /** 쿠폰 요소 메세지 최하단 노출  */
    setCoupon(coupon) {
        this.attachment.coupon = coupon;
        return this;
    }
    /** 커머스 요소  */
    setCommerce(commerce) {
        this.attachment.commerce = commerce;
        return this;
    }
    /** 비디오 요소  */
    setVideo(video) {
        this.attachment.video = video;
        return this;
    }
    build() {
        return this.attachment;
    }
}
