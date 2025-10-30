import { CarouselHead } from "../../../../interfaces/send/kakao/Friendtalk/Friendtalk";
/**
 * 클래스: FriendtalkCarouselHeadBuilder
 * 설명: 카카오 비즈메시지 친구톡 캐로셀의 헤더 정보를 나타냅니다.
 */
export declare class FriendtalkCarouselHeadBuilder {
    private head;
    /** 캐로셀 인트로 헤더 (최대 20자) */
    setHeader(header: string): this;
    /** 캐로셀 인트로 내용 (최대 50자) */
    setContent(content: string): this;
    /** 캐로셀 인트로 이미지 주소 */
    setImageUrl(imageUrl: string): this;
    /** 모바일 환경에서 인트로 클릭 시 이동할 URL (URL 필드 중 하나라도 값이 있으면 필수) */
    setUrlMobile(urlMobile: string): this;
    /** PC 환경에서 인트로 클릭 시 이동할 URL */
    setUrlPc(urlPc: string): this;
    /** 모바일 Android 환경에서 인트로 클릭 시 실행할 application custom scheme */
    setSchemeAndroid(schemeAndroid: string): this;
    /** 모바일 iOS 환경에서 인트로 클릭 시 실행할 application custom scheme */
    setSchemeIos(schemeIos: string): this;
    build(): CarouselHead;
}
