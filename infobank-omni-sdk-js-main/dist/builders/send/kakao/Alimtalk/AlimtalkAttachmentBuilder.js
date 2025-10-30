export class AlimtalkAttachmentBuilder {
    constructor() {
        this.attachment = {};
    }
    /** 알림톡 버튼 정보 */
    setButton(button) {
        this.attachment.button = button;
        return this;
    }
    /** 알림톡 아이템 정보 */
    setItem(item) {
        this.attachment.item = item;
        return this;
    }
    /** 알림톡 아이템 하이라이트 정보 */
    setItemHighlight(itemHighlight) {
        this.attachment.itemHighlight = itemHighlight;
        return this;
    }
    build() {
        return this.attachment;
    }
}
