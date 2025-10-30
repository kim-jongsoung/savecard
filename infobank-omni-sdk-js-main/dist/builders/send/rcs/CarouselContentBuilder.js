export class CarouselContentBuilder {
    constructor() {
        this.carouselContent = {};
    }
    /** RCS 내용 */
    setText(text) {
        this.carouselContent.text = text;
        return this;
    }
    /** RCS 제목 */
    setTitle(title) {
        this.carouselContent.title = title;
        return this;
    }
    /** 미디어(maapfile://) */
    setMedia(media) {
        this.carouselContent.media = media;
        return this;
    }
    /** 클릭 시 랜딩 URL
        (값이 '\' 경우 이미지 전체보기) */
    setMediaUrl(mediaUrl) {
        this.carouselContent.mediaUrl = mediaUrl;
        return this;
    }
    /** 버튼 정보 */
    setButton(button) {
        this.carouselContent.button = button;
        return this;
    }
    build() {
        return this.carouselContent;
    }
}
