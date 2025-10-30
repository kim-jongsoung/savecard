import { SubContent } from "../../../interfaces/send/rcs/RCSContent";
export declare class SubContentBuilder {
    private subContent;
    /** 서브 소제목 */
    setSubTitle(subTitle: string): this;
    /** 서브 소본문 */
    setSubDesc(subDesc: string): this;
    /** 서브 이미지 */
    setSubMedia(subMedia?: string): this;
    /** 서브 이미지 URL */
    setSubMediaUrl(subMediaUrl?: string): this;
    build(): SubContent;
}
