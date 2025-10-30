import { CalendarButtonBuilder } from './CalendarButtonBuilder';
import { ComTButtonBuilder } from './ComTButtonBuilder';
import { ComVButtonBuilder } from './ComVButtonBuilder';
import { CopyButtonBuilder } from './CopyButtonBuilder';
import { DialButtonBuilder } from './DialButtonBuilder';
import { MapLocButtonBuilder } from './MapLocButtonBuilder';
import { MapQryButtonBuilder } from './MapQryButtonBuilder';
import { MapSendButtonBuilder } from './MapSendButtonBuilder';
import { URLButtonBuilder } from './URLButtonBuilder';
export class RCSButtonBuilder {
    /** URL 연결 */
    createURLButton() {
        return new URLButtonBuilder();
    }
    /** 지도 보여주기 */
    createMapLocButton() {
        return new MapLocButtonBuilder();
    }
    /** 지도 검색 */
    createMapQryButton() {
        return new MapQryButtonBuilder();
    }
    /** 위치 전송 */
    createMapSendButton() {
        return new MapSendButtonBuilder();
    }
    /** 일정 등록 */
    createCalendarButton() {
        return new CalendarButtonBuilder();
    }
    /** 복사하기 */
    createCopyButton() {
        return new CopyButtonBuilder();
    }
    /** 대화방 열기(문자)  */
    createComTButton() {
        return new ComTButtonBuilder();
    }
    /** 대화방 열기(음성, 영상) */
    createComVButton() {
        return new ComVButtonBuilder();
    }
    /** 전화 연결 */
    createDialButton() {
        return new DialButtonBuilder();
    }
}
