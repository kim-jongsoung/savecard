export class SubContentBuilder {
    constructor() {
        this.subContent = {};
    }
    /** 서브 소제목 */
    setSubTitle(subTitle) {
        this.subContent.subTitle = subTitle;
        return this;
    }
    /** 서브 소본문 */
    setSubDesc(subDesc) {
        this.subContent.subDesc = subDesc;
        return this;
    }
    /** 서브 이미지 */
    setSubMedia(subMedia) {
        this.subContent.subMedia = subMedia;
        return this;
    }
    /** 서브 이미지 URL */
    setSubMediaUrl(subMediaUrl) {
        this.subContent.subMediaUrl = subMediaUrl;
        return this;
    }
    build() {
        return this.subContent;
    }
}
