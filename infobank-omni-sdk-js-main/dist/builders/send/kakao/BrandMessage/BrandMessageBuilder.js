/**
 * 클래스: BrandMEssageBuilder
 * 설명: OMNI 통합 발송과 FORM 등록/수정을 위한 BrandMessage 빌더 클래스입니다.
 */
export class BrandMessageBuilder {
    constructor() {
        this.brandMessage = {};
    }
    /** 카카오 비즈메시지 발신 프로필 키 */
    setSenderKey(senderKey) {
        this.brandMessage.senderKey = senderKey;
        return this;
    }
    /** 카카오 브랜드 메시지 타입 (basic: 기본형, free: 자유형) */
    setSendType(sendType) {
        this.brandMessage.sendType = sendType;
        return this;
    }
    /** 카카오 비즈메시지 타입 */
    setMsgType(msgType) {
        this.brandMessage.msgType = msgType;
        return this;
    }
    /** 친구톡 내용 */
    setText(text) {
        this.brandMessage.text = text;
        return this;
    }
    /** 친구톡 내용 */
    setCarousel(carousel) {
        this.brandMessage.carousel = carousel;
        return this;
    }
    /** 첨부 정보 */
    setAttachment(attachment) {
        this.brandMessage.attachment = attachment;
        return this;
    }
    /** 헤더 정보
        (msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setHeader(header) {
        this.brandMessage.header = header;
        return this;
    }
    /** 헤더 정보
      (msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setTargeting(targeting) {
        this.brandMessage.targeting = targeting;
        return this;
    }
    /** 헤더 정보
  (msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setTemplateCode(templateCode) {
        this.brandMessage.templateCode = templateCode;
        return this;
    }
    /** 헤더 정보
(msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setAddtionalContent(addtionalContent) {
        this.brandMessage.addtionalContent = addtionalContent;
        return this;
    }
    setGroupTagKey(groupTagKey) {
        this.brandMessage.groupTagKey = groupTagKey;
        return this;
    }
    setAdult(adult) {
        this.brandMessage.adult = adult;
        return this;
    }
    setPushAlarm(pushAlarm) {
        this.brandMessage.pushAlarm = pushAlarm;
        return this;
    }
    setAdFlag(adFlag) {
        this.brandMessage.adFlag = adFlag;
        return this;
    }
    setMessageVariable(messageVariable) {
        this.brandMessage.messageVariable = messageVariable;
        return this;
    }
    setButtonVariable(buttonVariable) {
        this.brandMessage.buttonVariable = buttonVariable;
        return this;
    }
    setCouponVariable(couponVariable) {
        this.brandMessage.couponVariable = couponVariable;
        return this;
    }
    setImageVariable(imageVariable) {
        this.brandMessage.imageVariable = imageVariable;
        return this;
    }
    setVideoVariable(videoVariable) {
        this.brandMessage.videoVariable = videoVariable;
        return this;
    }
    setCommerceVariable(commerceVariable) {
        this.brandMessage.commerceVariable = commerceVariable;
        return this;
    }
    setCarouselVariable(carouselVariable) {
        this.brandMessage.carouselVariable = carouselVariable;
        return this;
    }
    setOriginCID(originCID) {
        this.brandMessage.originCID = originCID;
        return this;
    }
    setUnsubscribePhoneNumber(unsubscribePhoneNumber) {
        this.brandMessage.unsubscribePhoneNumber = unsubscribePhoneNumber;
        return this;
    }
    setUnsubscribeAuthNumber(unsubscribeAuthNumber) {
        this.brandMessage.unsubscribeAuthNumber = unsubscribeAuthNumber;
        return this;
    }
    build() {
        return this.brandMessage;
    }
}
