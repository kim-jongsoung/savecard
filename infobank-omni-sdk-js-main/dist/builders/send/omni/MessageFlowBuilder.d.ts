import { Alimtalk } from "../../../interfaces/send/kakao/Alimtalk/Alimtalk";
import { Friendtalk } from "../../../interfaces/send/kakao/Friendtalk/Friendtalk";
import { MMS } from "../../../interfaces/send/mms/MMS";
import { MessageFlow } from "../../../interfaces/send/omni/MessageFlow";
import { RCS } from "../../../interfaces/send/rcs/RCS";
import { SMS } from "../../../interfaces/send/sms/SMS";
export declare class MessageFlowBuilder {
    private messageFlow;
    /** SMS 메시지 세부 사항 설정 (선택 사항) */
    setSMS(sms?: SMS): this;
    /** MMS 메시지 세부 사항 설정 (선택 사항) */
    setMMS(mms?: MMS): this;
    /** RCS 메시지 세부 사항 설정 (선택 사항) */
    setRCS(rcs?: RCS): this;
    /** 카카오 알림톡 메시지 세부 사항 설정 (선택 사항) */
    setAlimtalk(alimtalk?: Alimtalk): this;
    /** 카카오 친구톡 메시지 세부 사항 설정 (선택 사항) */
    setFriendtalk(friendtalk?: Friendtalk): this;
    /** MessageForm 배열 생성 */
    build(): Partial<MessageFlow>[];
}
