export class AlimtalkItemBuilder {
    constructor() {
        this.item = {};
    }
    /** 알림톡 아이템 리스트(2~10 개) */
    setList(list) {
        if (list.length < 2 || list.length > 10) {
            throw new Error('List must contain between 2 and 10 items.');
        }
        this.item.list = list;
        return this;
    }
    /** 알림톡 아이템 요약정보 */
    setSummary(summary) {
        this.item.summary = summary;
        return this;
    }
    build() {
        return this.item;
    }
}
