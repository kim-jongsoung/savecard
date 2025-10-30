import { DefaultOptions } from '../../interfaces/config/Config';
import { ReportResponseBody } from '../../interfaces/report/ReportResponseBody';
/**
 * Class: Report
 * Description: 메시지키를 기준으로 리포트를 조회합니다.
 * 리포트 연동방식(Polling / Webhook)으로 전달되지 못한 개별 리포트 들을 조회하기 위한 API 입니다.
 */
export declare class Report {
    private client;
    /**
     * Constructor: Report
     * Description: 인증 헤더로 Axiox client 를 초기화 합니다.
     * @param options - baseURL, token
     */
    constructor(options?: DefaultOptions);
    /**
     * Method: getDetailReport
     * Description: 리포트 개별 조회합니다.
     * @param reportPathParameter - msgKey
     * @returns
     */
    getDetailReport(msgkey: string): Promise<ReportResponseBody>;
    /**
     * Method: handleError
     * Description: 오류 세부 정보를 기록하여 API 오류를 처리합니다.
     * @param error
     */
    private handleError;
}
