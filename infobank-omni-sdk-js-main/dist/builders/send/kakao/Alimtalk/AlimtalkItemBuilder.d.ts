import { Item, ItemList, Summary } from "../../../../interfaces/send/kakao/Alimtalk/Alimtalk";
export declare class AlimtalkItemBuilder {
    private item;
    /** 알림톡 아이템 리스트(2~10 개) */
    setList(list: ItemList[]): this;
    /** 알림톡 아이템 요약정보 */
    setSummary(summary?: Summary): this;
    build(): Item;
}
