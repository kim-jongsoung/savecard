export class AlimtalkSupplementBuilder {
    constructor() {
        this.supplement = {};
    }
    /** 바로연결 정보  */
    setQuickReply(quickReply) {
        this.supplement.quickReply = quickReply;
        return this;
    }
    build() {
        return this.supplement;
    }
}
