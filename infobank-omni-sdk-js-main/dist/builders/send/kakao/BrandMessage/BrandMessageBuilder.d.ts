import { BrandMessage } from "../../../../interfaces/send/kakao/BrandMessage/BrandMessage";
import { Attachment, Carousel } from "../../../../interfaces/send/kakao/Friendtalk/Friendtalk";
/**
 * 클래스: BrandMEssageBuilder
 * 설명: OMNI 통합 발송과 FORM 등록/수정을 위한 BrandMessage 빌더 클래스입니다.
 */
export declare class BrandMessageBuilder {
    private brandMessage;
    /** 카카오 비즈메시지 발신 프로필 키 */
    setSenderKey(senderKey: string): this;
    /** 카카오 브랜드 메시지 타입 (basic: 기본형, free: 자유형) */
    setSendType(sendType: string): this;
    /** 카카오 비즈메시지 타입 */
    setMsgType(msgType: string): this;
    /** 친구톡 내용 */
    setText(text: string): this;
    /** 친구톡 내용 */
    setCarousel(carousel: Carousel): this;
    /** 첨부 정보 */
    setAttachment(attachment?: Attachment): this;
    /** 헤더 정보
        (msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setHeader(header?: string): this;
    /** 헤더 정보
      (msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setTargeting(targeting?: string): this;
    /** 헤더 정보
  (msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setTemplateCode(templateCode?: string): this;
    /** 헤더 정보
(msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setAddtionalContent(addtionalContent?: string): this;
    setGroupTagKey(groupTagKey?: string): this;
    setAdult(adult?: string): this;
    setPushAlarm(pushAlarm?: string): this;
    setAdFlag(adFlag?: string): this;
    setMessageVariable(messageVariable?: object): this;
    setButtonVariable(buttonVariable?: object): this;
    setCouponVariable(couponVariable?: object): this;
    setImageVariable(imageVariable?: object): this;
    setVideoVariable(videoVariable?: object): this;
    setCommerceVariable(commerceVariable?: object): this;
    setCarouselVariable(carouselVariable?: object): this;
    setOriginCID(originCID?: string): this;
    setUnsubscribePhoneNumber(unsubscribePhoneNumber?: string): this;
    setUnsubscribeAuthNumber(unsubscribeAuthNumber?: string): this;
    build(): BrandMessage;
}
