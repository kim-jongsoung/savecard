export class MessageFormBuilder {
    constructor() {
        this.messageForm = [];
    }
    /** SMS 메시지 세부 사항 설정 (선택 사항) */
    setSMS(sms) {
        if (sms) {
            this.messageForm.push({ sms });
        }
        return this;
    }
    /** MMS 메시지 세부 사항 설정 (선택 사항) */
    setMMS(mms) {
        if (mms) {
            this.messageForm.push({ mms });
        }
        return this;
    }
    /** RCS 메시지 세부 사항 설정 (선택 사항) */
    setRCS(rcs) {
        if (rcs) {
            this.messageForm.push({ rcs });
        }
        return this;
    }
    /** 카카오 알림톡 메시지 세부 사항 설정 (선택 사항) */
    setAlimtalk(alimtalk) {
        if (alimtalk) {
            this.messageForm.push({ alimtalk });
        }
        return this;
    }
    /** 카카오 친구톡 메시지 세부 사항 설정 (선택 사항) */
    setFriendtalk(friendtalk) {
        if (friendtalk) {
            this.messageForm.push({ friendtalk });
        }
        return this;
    }
    /** MessageForm 배열 생성 */
    build() {
        return this.messageForm;
    }
}
