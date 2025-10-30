export class RCSContentBuilder {
    constructor() {
        this.rcsContent = {};
    }
    /** RCS 내용 standalone (content/body 중 하나는 필수 입력)  */
    setStandaloneContent(standalone) {
        this.rcsContent.standalone = standalone;
        return this;
    }
    /** RCS 내용 carousel (content/body 중 하나는 필수 입력)  */
    setCarouselContent(carousel) {
        this.rcsContent.carousel = carousel;
        return this;
    }
    /** RCS 내용 template (content/body 중 하나는 필수 입력)   */
    setTemplateContent(template) {
        this.rcsContent.template = template;
        return this;
    }
    build() {
        return this.rcsContent;
    }
}
