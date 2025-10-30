export class AlimtalkItemListBuilder {
    constructor() {
        this.itemList = {};
    }
    /** 알림톡 아이템 리스트 타이틀  */
    setTitle(title) {
        if (title.length > 6) {
            throw new Error('Title length exceeds the maximum limit of 6 characters.');
        }
        this.itemList.title = title;
        return this;
    }
    /** 알림톡 아이템 리스트 부가정보 */
    setDescription(description) {
        this.itemList.description = description;
        return this;
    }
    build() {
        return this.itemList;
    }
}
