import { DefaultOptions } from '../../../interfaces/config/Config';
import { PollingResponseBody } from '../../../interfaces/report/polling/PollingResponseBody';
/**
 * Class: Polling
 * Description: 리포트를 Polling방식으로 수신합니다.
 */
export declare class Polling {
    private client;
    /**
     * Constructor: Polling
     * Description: 인증 헤더로 Axios client 를 초기화 합니다.
     * @param options - baseURL, token
     */
    constructor(options?: DefaultOptions);
    /**
     * Method: getReport
     * Description: 리포트를 가져옵니다.
     * @returns
     */
    getReport(): Promise<PollingResponseBody>;
    /**
     * Method: deleteReport
     * Description: 리포트 수신 확인합니다.
     * @param pollingPathParameter - reportId
     * @returns
     */
    deleteReport(reportId: string): Promise<PollingResponseBody>;
    /**
     * Method: makeRequest
     * Description: 지정한 URL로 GET 또는 DELETE 요청을 합니다.
     * @param method - 'get', 'delete'
     * @param url - URL
     * @returns
     */
    private makeRequest;
    /**
     * Method: handleError
     * Description: 오류 세부 정보를 기록하여 API 오류를 처리합니다.
     * @param error
     */
    private handleError;
}
