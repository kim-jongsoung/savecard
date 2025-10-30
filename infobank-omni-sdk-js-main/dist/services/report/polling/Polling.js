import axios from 'axios';
import { CONFIG } from '../../../interfaces/config/Config';
const API_VERSION = CONFIG.API_VERSION;
/**
 * Class: Polling
 * Description: 리포트를 Polling방식으로 수신합니다.
 */
export class Polling {
    /**
     * Constructor: Polling
     * Description: 인증 헤더로 Axios client 를 초기화 합니다.
     * @param options - baseURL, token
     */
    constructor(options = { baseURL: '', token: '' }) {
        this.client = axios.create({
            baseURL: options.baseURL,
            headers: {
                'Authorization': `Bearer ${options.token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        });
    }
    /**
     * Method: getReport
     * Description: 리포트를 가져옵니다.
     * @returns
     */
    async getReport() {
        return this.makeRequest('get', `/${API_VERSION}/report/polling`);
    }
    /**
     * Method: deleteReport
     * Description: 리포트 수신 확인합니다.
     * @param pollingPathParameter - reportId
     * @returns
     */
    async deleteReport(reportId) {
        return this.makeRequest('delete', `/${API_VERSION}/report/polling/${reportId}`);
    }
    /**
     * Method: makeRequest
     * Description: 지정한 URL로 GET 또는 DELETE 요청을 합니다.
     * @param method - 'get', 'delete'
     * @param url - URL
     * @returns
     */
    async makeRequest(method, url) {
        try {
            const response = await this.client.request({ method, url });
            return response.data;
        }
        catch (error) {
            this.handleError(error);
            throw error;
        }
    }
    /**
     * Method: handleError
     * Description: 오류 세부 정보를 기록하여 API 오류를 처리합니다.
     * @param error
     */
    handleError(error) {
        if (error.response) {
            console.error(`[API error]: ${error.response.status} ${error.response.statusText}`);
            console.error(error.response.data);
        }
        else {
            console.error('[API error]:', error.message);
        }
    }
}
