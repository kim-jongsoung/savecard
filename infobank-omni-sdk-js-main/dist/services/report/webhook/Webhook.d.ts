import { DefaultOptions } from '../../../interfaces/config/Config';
import { WebhookRequestBody, WebhookPathParameter } from '../../../interfaces/report/webhook/WebhookRequestBody';
import { WebhookResponseBody } from '../../../interfaces/report/webhook/WebhookResponseBody';
/**
 * Class: Webhook
 * Description: 리포트를 Webhook방식으로 고객서버에 전달합니다.
 */
export declare class Webhook {
    private client;
    /**
     * Constructor: Webhook
     * Description: 인증 헤더로 Axiox client 를 초기화 합니다.
     * @param options - baseURL, token
     */
    constructor(options?: DefaultOptions);
    /**
     * Method: getWebhook
     * Description: 리포트 데이터를 Webhook 방식으로 사용자URL에  전달합니다.
     * @param webhookPathParameter - 계정에 등록된 사용자 URL
     * @param webhookRequest - 리포트 정보
     * @returns
     */
    getWebhook(webhookPathParameter: WebhookPathParameter, webhookRequest: WebhookRequestBody): Promise<WebhookResponseBody>;
    /**
     * Method: handleError
     * Description: 오류 세부 정보를 기록하여 API 오류를 처리합니다.
     * @param error
     */
    private handleError;
}
