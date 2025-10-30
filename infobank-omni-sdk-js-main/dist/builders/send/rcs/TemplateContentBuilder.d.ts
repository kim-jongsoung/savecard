import { SubContent, TemplateContent } from "../../../interfaces/send/rcs/RCSContent";
export declare class TemplateContentBuilder {
    private templateContent;
    /** 템플릿 제목 */
    setTitle(title: string): this;
    /** 템플릿 본문 */
    setDescription(description: string): this;
    /** 서브 컨텐트 정보 */
    setSubContent(subContent?: SubContent[]): this;
    /** 사전에  등록된 key, value(JSON) */
    setCustomField(key: string, value: string): this;
    build(): TemplateContent;
}
