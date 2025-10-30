import { CarouselContent, RCSButton } from "../../../interfaces/send/rcs/RCSContent";
export declare class CarouselContentBuilder {
    private carouselContent;
    /** RCS 내용 */
    setText(text: string): this;
    /** RCS 제목 */
    setTitle(title: string): this;
    /** 미디어(maapfile://) */
    setMedia(media?: string): this;
    /** 클릭 시 랜딩 URL
        (값이 '\' 경우 이미지 전체보기) */
    setMediaUrl(mediaUrl?: string): this;
    /** 버튼 정보 */
    setButton(button?: RCSButton[]): this;
    build(): CarouselContent;
}
