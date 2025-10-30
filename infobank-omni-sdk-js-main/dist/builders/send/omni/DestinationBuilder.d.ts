import { Destination } from "../../../interfaces/send/omni/Destination";
export declare class DestinationBuilder {
    private destination;
    /** 수신번호 설정 */
    setTo(to: string): this;
    /** 치환 문구 설정 (JSON) */
    setReplaceWords(replaceWords?: object): this;
    /** Destinations 객체 생성 */
    build(): Destination;
}
