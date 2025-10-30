export class FriendtalkItemBuilder {
    constructor() {
        this.item = {};
    }
    /** 와이드 리스트 요소 */
    setList(list) {
        this.item.list = list;
        return this;
    }
    build() {
        return this.item;
    }
}
