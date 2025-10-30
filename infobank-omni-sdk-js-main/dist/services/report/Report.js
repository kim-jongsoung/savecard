import axios from 'axios';
import { CONFIG } from '../../interfaces/config/Config';
const API_VERSION = CONFIG.API_VERSION;
/**
 * Class: Report
 * Description: 메시지키를 기준으로 리포트를 조회합니다.
 * 리포트 연동방식(Polling / Webhook)으로 전달되지 못한 개별 리포트 들을 조회하기 위한 API 입니다.
 */
export class Report {
    /**
     * Constructor: Report
     * Description: 인증 헤더로 Axiox client 를 초기화 합니다.
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
     * Method: getDetailReport
     * Description: 리포트 개별 조회합니다.
     * @param reportPathParameter - msgKey
     * @returns
     */
    async getDetailReport(msgkey) {
        try {
            const response = await this.client.get(`/${API_VERSION}/report/inquiry/${msgkey}`);
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
