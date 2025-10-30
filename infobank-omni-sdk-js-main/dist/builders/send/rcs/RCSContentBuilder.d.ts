import { CarouselContent, RCSContent, StandaloneContent, TemplateContent } from "../../../interfaces/send/rcs/RCSContent";
export declare class RCSContentBuilder {
    private rcsContent;
    /** RCS 내용 standalone (content/body 중 하나는 필수 입력)  */
    setStandaloneContent(standalone: StandaloneContent): this;
    /** RCS 내용 carousel (content/body 중 하나는 필수 입력)  */
    setCarouselContent(carousel: CarouselContent[]): this;
    /** RCS 내용 template (content/body 중 하나는 필수 입력)   */
    setTemplateContent(template: TemplateContent): this;
    build(): RCSContent;
}
