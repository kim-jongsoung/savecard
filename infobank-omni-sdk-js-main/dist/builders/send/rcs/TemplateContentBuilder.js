export class TemplateContentBuilder {
    constructor() {
        this.templateContent = {};
    }
    /** 템플릿 제목 */
    setTitle(title) {
        this.templateContent.title = title;
        return this;
    }
    /** 템플릿 본문 */
    setDescription(description) {
        this.templateContent.description = description;
        return this;
    }
    /** 서브 컨텐트 정보 */
    setSubContent(subContent) {
        this.templateContent.subContent = subContent;
        return this;
    }
    /** 사전에  등록된 key, value(JSON) */
    setCustomField(key, value) {
        this.templateContent[key] = value;
        return this;
    }
    build() {
        return this.templateContent;
    }
}
