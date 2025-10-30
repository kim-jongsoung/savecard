import { Item, ItemList } from "../../../../interfaces/send/kakao/Friendtalk/Friendtalk";
export declare class FriendtalkItemBuilder {
    private item;
    /** 와이드 리스트 요소 */
    setList(list: ItemList[]): this;
    build(): Item;
}
