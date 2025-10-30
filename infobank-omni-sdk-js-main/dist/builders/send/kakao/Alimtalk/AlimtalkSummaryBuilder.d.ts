import { Summary } from "../../../../interfaces/send/kakao/Alimtalk/Alimtalk";
export declare class AlimtalkSummaryBuilder {
    private summary;
    /** 알림톡 아이템 요약정보 타이틀 (최대 길이 6) */
    setTitle(title: string): this;
    /** 알림톡 아이템 요약정보 설명  */
    setDescription(description: string): this;
    /** Summary 객체 생성 */
    build(): Summary;
}
