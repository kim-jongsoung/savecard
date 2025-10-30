import { CalendarButton } from "../../../interfaces/send/rcs/RCSContent";
/**
 * 클래스: CalendarButtonBuilder
 * 설명: 정해진 일자와 내용으로 일정을 등록합니다. (CALENDAR)
 */
export declare class CalendarButtonBuilder {
    private button;
    /** 버튼 명 */
    setName(name: string): this;
    /** 시작 일정(yyyy-MM-dd’T’HH:mm:ssXXX) */
    setStartTime(startTime: string): this;
    /** 종료 일정(yyyy-MM-dd’T’HH:mm:ssXXX) */
    setEndTime(endTime: string): this;
    /** 일정 제목 */
    setTitle(title: string): this;
    /** 일정 내용 */
    setDescription(description: string): this;
    build(): CalendarButton;
}
