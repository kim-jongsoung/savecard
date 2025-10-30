import { FormRequestBody } from '../../../interfaces/registration/form/FormRequestBody';
import { FormResponseBody } from '../../../interfaces/registration/form/FormResponseBody';
import { DefaultOptions } from '../../../interfaces/config/Config';
/**
 * Class: Form
 * Description: 사전에 자주 전송하는 메시지 형태를 등록합니다. 통합메시지 전송 시 메시지폼 ID를 입력하여 전송할 수 있습니다.
 */
export declare class Form {
    private client;
    /**
     * Constructor: Form
     * Description: 인증 헤더로 Axios client 를 초기화 합니다.
     * @param options - baseURL, token
     */
    constructor(options?: DefaultOptions);
    /**
     * Method: registForm
     * Description: 메세지 폼을 등록합니다.
     * @param formRequest - formData
     * @returns
     */
    registForm(formRequest: FormRequestBody): Promise<FormResponseBody>;
    /**
     * Method: getFormData
     * Description: 메세지 폼을 조회합니다.
     * @param formId - formId
     * @returns
     */
    getFormData(formId: string): Promise<FormResponseBody>;
    /**
     * Method: modifyForm
     * Description: 메세지 폼을 수정합니다.
     * @param formId - formId
     * @param formRequest - formData
     * @returns
     */
    modifyForm(formId: string, formRequest: FormRequestBody): Promise<FormResponseBody>;
    /**
     * Method: deleteForm
     * Description: 메세지 폼을 삭제합니다.
     * @param formId - formId
     * @returns
     */
    deleteForm(formId: string): Promise<FormResponseBody>;
    /**
     * Method: requestWithPayload
     * Description: POST, PUT 을 호출합니다.
     * @param method - 'post' or 'put'
     * @param url - URL
     * @param formRequest - formData
     * @returns
     */
    private requestWithPayload;
    /**
     * Method: requestWithoutPayload
     * Description: GET, DELETE 를 호출합니다.
     * @param method -'get' or 'delete'
     * @param url - URL
     * @returns
     */
    private requestWithoutPayload;
    /**
     * Method: handleError
     * Description: 오류 세부 정보를 기록하여 API 오류를 처리합니다.
     * @param error
     */
    private handleError;
}
