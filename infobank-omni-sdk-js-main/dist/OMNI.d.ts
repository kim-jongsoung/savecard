import { Auth } from './index';
import { OMNIOptions } from './interfaces/config/Config';
import { File } from './services/registration/file/File';
import { Form } from './services/registration/form/Form';
import { Polling } from './services/report/polling/Polling';
import { Report } from './services/report/Report';
import { Webhook } from './services/report/webhook/Webhook';
import { Send } from './services/send/Send';
export declare class OMNI {
    auth?: Auth;
    send?: Send;
    form?: Form;
    polling?: Polling;
    webhook?: Webhook;
    file?: File;
    report?: Report;
    /**
     * OMNI SDK의 인스턴스를 생성합니다.
     *
     * @param config - 인증, 메시지 전송, 폼 제출 등 설정 옵션입니다.
     */
    constructor(config: OMNIOptions);
    /**
     * Initializes the modules with the provided parameters.
     *
     * @param param - The parameters including baseURL and token.
     */
    private initializeModules;
}
