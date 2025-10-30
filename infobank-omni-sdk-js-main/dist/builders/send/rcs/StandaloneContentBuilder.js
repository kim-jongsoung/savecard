export class StandaloneContentBuilder {
    constructor() {
        this.standaloneContent = {};
    }
    /** RCS 내용 */
    setText(text) {
        this.standaloneContent.text = text;
        return this;
    }
    /** RCS 제목 */
    setTitle(title) {
        this.standaloneContent.title = title;
        return this;
    }
    /** 미디어(maapfile://) */
    setMedia(media) {
        this.standaloneContent.media = media;
        return this;
    }
    /** 클릭 시 랜딩 URL (값이 '\' 경우 이미지 전체보기) */
    setMediaUrl(mediaUrl) {
        this.standaloneContent.mediaUrl = mediaUrl;
        return this;
    }
    /** 버튼 정보 */
    setButton(button) {
        this.standaloneContent.button = button;
        return this;
    }
    /** 서브 컨텐트 정보  */
    setSubContent(subContent) {
        this.standaloneContent.subContent = subContent;
        return this;
    }
    build() {
        return this.standaloneContent;
    }
}
