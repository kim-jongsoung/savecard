import { Attachment, Item, ItemHighlight } from "../../../../interfaces/send/kakao/Alimtalk/Alimtalk";
import { KakaoButton } from "../../../../interfaces/send/kakao/KakaoButton";
export declare class AlimtalkAttachmentBuilder {
    private attachment;
    /** 알림톡 버튼 정보 */
    setButton(button?: KakaoButton[]): this;
    /** 알림톡 아이템 정보 */
    setItem(item?: Item): this;
    /** 알림톡 아이템 하이라이트 정보 */
    setItemHighlight(itemHighlight?: ItemHighlight): this;
    build(): Attachment;
}
