export class FriendtalkRequestBodyBuilder {
    constructor() {
        this.friendtalkRequestBody = {};
    }
    /** 카카오 비즈메시지 발신 프로필 키 설정 */
    setSenderKey(senderKey) {
        this.friendtalkRequestBody.senderKey = senderKey;
        return this;
    }
    /** 카카오 친구톡 메시지타입 설정 */
    setMsgType(msgType) {
        this.friendtalkRequestBody.msgType = msgType;
        return this;
    }
    /** 수신번호 설정 */
    setTo(to) {
        this.friendtalkRequestBody.to = to;
        return this;
    }
    /** 친구톡 내용 설정 (최대 90자) */
    setText(text) {
        if (text.length > 90) {
            throw new Error('Text length exceeds the maximum limit of 90 characters.');
        }
        this.friendtalkRequestBody.text = text;
        return this;
    }
    /** 친구톡 이미지 URL 설정 */
    setImgUrl(imgUrl) {
        this.friendtalkRequestBody.imgUrl = imgUrl;
        return this;
    }
    /** 친구톡 버튼정보 설정 */
    setButton(button) {
        this.friendtalkRequestBody.button = button;
        return this;
    }
    /** 참조필드 설정 (최대 200자) */
    setRef(ref) {
        if (ref && ref.length > 200) {
            throw new Error('Ref length exceeds the maximum limit of 200 characters.');
        }
        this.friendtalkRequestBody.ref = ref;
        return this;
    }
    /** 실패 시 전송될 Fallback 메시지 정보 설정 */
    setFallback(fallback) {
        this.friendtalkRequestBody.fallback = fallback;
        return this;
    }
    /** FriendtalkRequestBody 객체 생성 */
    build() {
        return this.friendtalkRequestBody;
    }
}
