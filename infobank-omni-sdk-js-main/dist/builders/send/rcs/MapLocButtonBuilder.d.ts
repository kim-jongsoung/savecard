import { MapLocButton } from "../../../interfaces/send/rcs/RCSContent";
/**
 * 클래스: MapLocButtonBuilder
 * 설명: 	지정된 좌표로 설정된 지도 App을 실행합니다. (MAP_LOC)
 */
export declare class MapLocButtonBuilder {
    private button;
    /** 버튼 명 */
    setName(name: string): this;
    /** 지도 App에 표시될 라벨명 */
    setLabel(label: string): this;
    /** 위도 값(예)37.4001971 */
    setLatitude(latitude: string): this;
    /** 경도 값 (예)127.1071718 */
    setLongitude(longitude: string): this;
    /** 지도 App동작이 안 될 경우 대처할 URL */
    setFallbackUrl(fallbackUrl: string): this;
    build(): MapLocButton;
}
