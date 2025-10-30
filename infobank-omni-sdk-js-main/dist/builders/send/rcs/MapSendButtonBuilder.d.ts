import { MapSendButton } from "../../../interfaces/send/rcs/RCSContent";
/**
 * 클래스: MapSendButtonBuilder
 * 설명: 휴대폰의 현재 위치 정보를 전송합니다. (MAP_SEND)
 */
export declare class MapSendButtonBuilder {
    private button;
    /** 버튼 명 */
    setName(name: string): this;
    build(): MapSendButton;
}
