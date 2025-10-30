export class AlimtalkSummaryBuilder {
    constructor() {
        this.summary = {};
    }
    /** 알림톡 아이템 요약정보 타이틀 (최대 길이 6) */
    setTitle(title) {
        if (title.length > 6) {
            throw new Error('Title length exceeds the maximum limit of 6 characters.');
        }
        this.summary.title = title;
        return this;
    }
    /** 알림톡 아이템 요약정보 설명  */
    setDescription(description) {
        this.summary.description = description;
        return this;
    }
    /** Summary 객체 생성 */
    build() {
        return this.summary;
    }
}
