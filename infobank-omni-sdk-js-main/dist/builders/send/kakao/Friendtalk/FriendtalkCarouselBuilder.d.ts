import { Carousel, CarouselHead, CarouselList, CarouselTail } from "../../../../interfaces/send/kakao/Friendtalk/Friendtalk";
/**
 * 클래스: FriendtalkCarouselBuilder
 * 설명: 카카오 비즈메시지 친구톡 캐로셀 정보를 나타냅니다.
 */
export declare class FriendtalkCarouselBuilder {
    private carousel;
    /** 캐로셀 인트로 정보
        (msgType이 FC인 경우 사용 불가) */
    setHead(head?: CarouselHead): this;
    /** 캐로셀 아이템 리스트 (최소: 2, 최대: 10) */
    setList(list?: CarouselList[]): this;
    /** 더보기 버튼 정보 */
    setTail(tail?: CarouselTail): this;
    build(): Carousel;
}
