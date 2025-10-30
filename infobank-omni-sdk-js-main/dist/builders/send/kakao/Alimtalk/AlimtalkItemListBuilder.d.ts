import { ItemList } from "../../../../interfaces/send/kakao/Alimtalk/Alimtalk";
export declare class AlimtalkItemListBuilder {
    private itemList;
    /** 알림톡 아이템 리스트 타이틀  */
    setTitle(title: string): this;
    /** 알림톡 아이템 리스트 부가정보 */
    setDescription(description: string): this;
    build(): ItemList;
}
