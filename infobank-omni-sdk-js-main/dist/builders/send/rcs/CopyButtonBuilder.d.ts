import { CopyButton } from "../../../interfaces/send/rcs/RCSContent";
/**
 * 클래스: CopyButtonBuilder
 * 설명: 지정된 내용을 클립보드로 복사합니다. (COPY)
 */
export declare class CopyButtonBuilder {
    private button;
    /** 버튼 명 */
    setName(name: string): this;
    /** 클립보드로 복사될 내용 */
    setText(text: string): this;
    build(): CopyButton;
}
