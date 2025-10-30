import axios from 'axios';
import { CONFIG } from '../../../interfaces/config/Config';
const API_VERSION = CONFIG.API_VERSION;
/**
 * Class: Form
 * Description: 사전에 자주 전송하는 메시지 형태를 등록합니다. 통합메시지 전송 시 메시지폼 ID를 입력하여 전송할 수 있습니다.
 */
export class Form {
    /**
     * Constructor: Form
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
     * Method: registForm
     * Description: 메세지 폼을 등록합니다.
     * @param formRequest - formData
     * @returns
     */
    async registForm(formRequest) {
        return this.requestWithPayload('post', `/${API_VERSION}/form`, formRequest);
    }
    /**
     * Method: getFormData
     * Description: 메세지 폼을 조회합니다.
     * @param formId - formId
     * @returns
     */
    async getFormData(formId) {
        return this.requestWithoutPayload('get', `/${API_VERSION}/form/${formId}`);
    }
    /**
     * Method: modifyForm
     * Description: 메세지 폼을 수정합니다.
     * @param formId - formId
     * @param formRequest - formData
     * @returns
     */
    async modifyForm(formId, formRequest) {
        return this.requestWithPayload('put', `/${API_VERSION}/form/${formId}`, formRequest);
    }
    /**
     * Method: deleteForm
     * Description: 메세지 폼을 삭제합니다.
     * @param formId - formId
     * @returns
     */
    async deleteForm(formId) {
        return this.requestWithoutPayload('delete', `/${API_VERSION}/form/${formId}`);
    }
    /**
     * Method: requestWithPayload
     * Description: POST, PUT 을 호출합니다.
     * @param method - 'post' or 'put'
     * @param url - URL
     * @param formRequest - formData
     * @returns
     */
    async requestWithPayload(method, url, formRequest) {
        try {
            const response = await this.client[method](url, JSON.stringify(formRequest));
            return response.data;
        }
        catch (error) {
            this.handleError(error);
            throw error;
        }
    }
    /**
     * Method: requestWithoutPayload
     * Description: GET, DELETE 를 호출합니다.
     * @param method -'get' or 'delete'
     * @param url - URL
     * @returns
     */
    async requestWithoutPayload(method, url) {
        try {
            const response = await this.client[method](url);
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
            const safeResponse = JSON.parse(JSON.stringify(error.response, getCircularReplacer()));
            console.error(`[API error]: ${safeResponse.status} ${safeResponse.statusText}`);
        }
        else if (error.request) {
            console.error('[API error]: No response received', error.request);
        }
        else {
            console.error('[API error]:', error.message);
        }
        console.error("Config data:", error.config);
    }
}
function getCircularReplacer() {
    const seen = new WeakSet();
    return (key, value) => {
        if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }
        return value;
    };
}
