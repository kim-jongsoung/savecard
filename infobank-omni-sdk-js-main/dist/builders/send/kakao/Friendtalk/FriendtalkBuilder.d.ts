import { Attachment, Carousel, Friendtalk } from "../../../../interfaces/send/kakao/Friendtalk/Friendtalk";
/**
 * 클래스: FriendtalkBuilder
 * 설명: OMNI 통합 발송과 FORM 등록/수정을 위한 Friendtalk 빌더 클래스입니다.
 */
export declare class FriendtalkBuilder {
    private friendtalk;
    /** 카카오 비즈메시지 발신 프로필 키 */
    setSenderKey(senderKey: string): this;
    /** 카카오 비즈메시지 타입 */
    setMsgType(msgType: string): this;
    /** 친구톡 내용 */
    setText(text: string): this;
    /** 부가정보 (msgType이 FM인 경우 사용) */
    setAdditionalContent(additionalContent?: string): this;
    /** 광고성메시지 필수 표기 사항 노출 여부(Y(기본값)/N)
        (msgType이 FL, FC, FA인  경우  Y로만  발송 가능) */
    setAdFlag(adFlag?: string): this;
    /** 성인용 메시지 여부(Y/N(기본값)) */
    setAdult(adult?: string): this;
    /** 첨부 정보 */
    setAttachment(attachment?: Attachment): this;
    /** 헤더 정보
        (msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setHeader(header?: string): this;
    /** 캐로셀 정보 (msgType이 FC, FA 인 경우 필수) */
    setCarousel(carousel?: Carousel): this;
    /** 그룹태그 등록으로 받은 그룹태그 키 */
    setGroupTagKey(groupTagKey?: string): this;
    /** 메시지 푸시 알람 발송 여부( Y(기본값) / N ) */
    setPushAlarm(pushAlarm?: string): this;
    build(): Friendtalk;
}
