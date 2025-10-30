import { CarouselTail } from "../../../../interfaces/send/kakao/Friendtalk/Friendtalk";
/**
 * 클래스: FriendtalkCarouselTailBuilder
 * 설명: 카카오 비즈메시지 친구톡 캐로셀의 더보기 정보를 나타냅니다.
 */
export declare class FriendtalkCarouselTailBuilder {
    private tail;
    /** PC 환경에서 버튼 클릭 시 이동할 URL */
    setUrlPc(urlPc: string): this;
    /** 모바일 환경에서 버튼 클릭 시 이동할 URL */
    setUrlMobile(urlMobile: string): this;
    /** 모바일 iOS 환경에서 버튼 클릭 시 실행할 application custom scheme */
    setSchemeIos(schemeIos: string): this;
    /** 모바일 Android 환경에서 버튼 클릭 시 실행할 application custom scheme */
    setSchemeAndroid(schemeAndroid: string): this;
    build(): CarouselTail;
}
