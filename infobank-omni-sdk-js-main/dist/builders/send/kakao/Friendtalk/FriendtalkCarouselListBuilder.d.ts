import { CarouselList, CarouselListAttachment } from "../../../../interfaces/send/kakao/Friendtalk/Friendtalk";
/**
 * 클래스: FriendtalkCarouselListBuilder
 * 설명: 카카오 비즈메시지 친구톡 캐로셀의 리스트 정보를 나타냅니다.
 */
export declare class FriendtalkCarouselListBuilder {
    private list;
    /** 캐로셀 아이템 제목 (msgType이 FC인 경우 필수, FA인 경우 사용 불가, 최대 20자) */
    setHeader(header: string): this;
    /** 캐로셀 아이템 메시지 (msgType이 FC인 경우 필수, FA인 경우 사용 불가, 최대 180자) */
    setMessage(message: string): this;
    /** 부가 정보 (msgType이 FC인 경우 사용 불가, 최대 34자) */
    setAdditionalContent(additionalContent: string): this;
    /** 캐로셀 첨부 정보 */
    setAttachment(attachment: CarouselListAttachment): this;
    build(): CarouselList;
}
