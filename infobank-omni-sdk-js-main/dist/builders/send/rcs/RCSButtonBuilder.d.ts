import { CalendarButtonBuilder } from './CalendarButtonBuilder';
import { ComTButtonBuilder } from './ComTButtonBuilder';
import { ComVButtonBuilder } from './ComVButtonBuilder';
import { CopyButtonBuilder } from './CopyButtonBuilder';
import { DialButtonBuilder } from './DialButtonBuilder';
import { MapLocButtonBuilder } from './MapLocButtonBuilder';
import { MapQryButtonBuilder } from './MapQryButtonBuilder';
import { MapSendButtonBuilder } from './MapSendButtonBuilder';
import { URLButtonBuilder } from './URLButtonBuilder';
export declare class RCSButtonBuilder {
    /** URL 연결 */
    createURLButton(): URLButtonBuilder;
    /** 지도 보여주기 */
    createMapLocButton(): MapLocButtonBuilder;
    /** 지도 검색 */
    createMapQryButton(): MapQryButtonBuilder;
    /** 위치 전송 */
    createMapSendButton(): MapSendButtonBuilder;
    /** 일정 등록 */
    createCalendarButton(): CalendarButtonBuilder;
    /** 복사하기 */
    createCopyButton(): CopyButtonBuilder;
    /** 대화방 열기(문자)  */
    createComTButton(): ComTButtonBuilder;
    /** 대화방 열기(음성, 영상) */
    createComVButton(): ComVButtonBuilder;
    /** 전화 연결 */
    createDialButton(): DialButtonBuilder;
}
