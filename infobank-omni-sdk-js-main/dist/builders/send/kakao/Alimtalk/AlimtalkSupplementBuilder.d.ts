import { QuickReply, Supplement } from "../../../../interfaces/send/kakao/Alimtalk/Alimtalk";
export declare class AlimtalkSupplementBuilder {
    private supplement;
    /** 바로연결 정보  */
    setQuickReply(quickReply?: QuickReply[]): this;
    build(): Supplement;
}
