/**
 * 클래스: MapLocButtonBuilder
 * 설명: 	지정된 좌표로 설정된 지도 App을 실행합니다. (MAP_LOC)
 */
export class MapLocButtonBuilder {
    constructor() {
        this.button = { type: 'MAP_LOC' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 지도 App에 표시될 라벨명 */
    setLabel(label) {
        this.button.label = label;
        return this;
    }
    /** 위도 값(예)37.4001971 */
    setLatitude(latitude) {
        this.button.latitude = latitude;
        return this;
    }
    /** 경도 값 (예)127.1071718 */
    setLongitude(longitude) {
        this.button.longitude = longitude;
        return this;
    }
    /** 지도 App동작이 안 될 경우 대처할 URL */
    setFallbackUrl(fallbackUrl) {
        this.button.fallbackUrl = fallbackUrl;
        return this;
    }
    build() {
        return this.button;
    }
}
