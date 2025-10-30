import axios from 'axios';
import { stringify } from 'flatted';

/**
   * const: API 버전
   */
const CONFIG = {
    API_VERSION: "v1"
};

/**
 * Class: FileUpload
 * Description: 메시지 발송에 필요한 이미지 파일을 관리 합니다.
 */
class File {
    /**
     * Constructor: FileUpload
     * Description: 인증 헤더로 Axios client 를 초기화 합니다.
     * @param options - baseURL, token
     */
    constructor(options = { baseURL: '', token: '' }) {
        this.client = axios.create({
            baseURL: options.baseURL,
            headers: {
                'Authorization': `Bearer ${options.token}`,
                'Content-Type': 'multipart/form-data',
                'Accept': 'application/json',
            },
        });
    }
    /**
     * Method: uploadFile
     * Description: 이미지 파일을 업로드 합니다.
     * @param fileUploadPathParameter - serviceType, msgType
     * @param fileUploadRequest - fileData
     * @returns
     */
    async uploadFile(fileUploadPathParameter, fileUploadRequest) {
        try {
            const response = await this.client.post(`/v1/file/${fileUploadPathParameter.serviceType}` +
                `${fileUploadPathParameter.msgType ? `/${fileUploadPathParameter.msgType}` : ''}` +
                `${fileUploadPathParameter.subType ? `/${fileUploadPathParameter.subType}` : ''}`, fileUploadRequest);
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

const API_VERSION$4 = CONFIG.API_VERSION;
/**
 * Class: Form
 * Description: 사전에 자주 전송하는 메시지 형태를 등록합니다. 통합메시지 전송 시 메시지폼 ID를 입력하여 전송할 수 있습니다.
 */
class Form {
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
        return this.requestWithPayload('post', `/${API_VERSION$4}/form`, formRequest);
    }
    /**
     * Method: getFormData
     * Description: 메세지 폼을 조회합니다.
     * @param formId - formId
     * @returns
     */
    async getFormData(formId) {
        return this.requestWithoutPayload('get', `/${API_VERSION$4}/form/${formId}`);
    }
    /**
     * Method: modifyForm
     * Description: 메세지 폼을 수정합니다.
     * @param formId - formId
     * @param formRequest - formData
     * @returns
     */
    async modifyForm(formId, formRequest) {
        return this.requestWithPayload('put', `/${API_VERSION$4}/form/${formId}`, formRequest);
    }
    /**
     * Method: deleteForm
     * Description: 메세지 폼을 삭제합니다.
     * @param formId - formId
     * @returns
     */
    async deleteForm(formId) {
        return this.requestWithoutPayload('delete', `/${API_VERSION$4}/form/${formId}`);
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

const API_VERSION$3 = CONFIG.API_VERSION;
/**
 * Class: Polling
 * Description: 리포트를 Polling방식으로 수신합니다.
 */
class Polling {
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
        return this.makeRequest('get', `/${API_VERSION$3}/report/polling`);
    }
    /**
     * Method: deleteReport
     * Description: 리포트 수신 확인합니다.
     * @param pollingPathParameter - reportId
     * @returns
     */
    async deleteReport(reportId) {
        return this.makeRequest('delete', `/${API_VERSION$3}/report/polling/${reportId}`);
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

const API_VERSION$2 = CONFIG.API_VERSION;
/**
 * Class: Report
 * Description: 메시지키를 기준으로 리포트를 조회합니다.
 * 리포트 연동방식(Polling / Webhook)으로 전달되지 못한 개별 리포트 들을 조회하기 위한 API 입니다.
 */
class Report {
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
            const response = await this.client.get(`/${API_VERSION$2}/report/inquiry/${msgkey}`);
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

/**
 * Class: Webhook
 * Description: 리포트를 Webhook방식으로 고객서버에 전달합니다.
 */
class Webhook {
    /**
     * Constructor: Webhook
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
     * Method: getWebhook
     * Description: 리포트 데이터를 Webhook 방식으로 사용자URL에  전달합니다.
     * @param webhookPathParameter - 계정에 등록된 사용자 URL
     * @param webhookRequest - 리포트 정보
     * @returns
     */
    async getWebhook(webhookPathParameter, webhookRequest) {
        try {
            const response = await this.client.post(webhookPathParameter.userURL, webhookRequest);
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

const API_VERSION$1 = "/v1";
/**
 * Class: Send
 * Description: 메세지 전송 API
 */
class Send {
    /**
     * Constructor: Send
     * Description: 인증 헤더로 Axios client 를 초기화 합니다.
     * @param options - baseURL, token
     */
    constructor(options) {
        this.client = axios.create({
            baseURL: options.baseURL,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${options.token}`,
                'Accept': 'application/json',
            },
        });
    }
    /**
     * Method: SMS
     * Description: 국내 문자(SMS) 메시지 발송 규격입니다.
     * SMS 최대 90byte, MMS 최대 2,000byte(제목 20byte) 까지 전송 가능 합니다.
     * OMNI Gitbook 상세 Response 내용은 코드표를 참조해주시기 바랍니다.
     *
     * @param body - SMS Request
     * @returns
     */
    async SMS(req) {
        return this.sendRequest(`${API_VERSION$1}/send/sms`, req);
    }
    /**
     * Method: MMS
     * Description: 국내 문자(LMS, MMS) 메시지 발송 규격입니다.
     * MMS 이미지 메시지를 전송할 경우 사전에 이미지 파일 등록이 필요 합니다.
     * OMNI Gitbook 상세 Response 내용은 코드표를 참조해주시기 바랍니다.
     *
     * @param body - MMS Request
     * @returnsparam
     */
    async MMS(req) {
        return this.sendRequest(`${API_VERSION$1}/send/mms`, req);
    }
    /**
     * Method: International
     * Description: 국제 문자(SMS) 메시지 발송 규격입니다.
     * 장문 메시지를 보낼 경우 Concatenated SMS(분할 전송)로 전송됩니다.
     * 요청 시 DLR 정보를 수신 받을 수 있습니다. (영업담당자 문의)
     *
     * @param body - International Request
     * @returnsparam
     */
    async International(req) {
        return this.sendRequest(`${API_VERSION$1}/send/international`, req);
    }
    /**
     * Method: RCS
     * Description: RCS 메시지 발송 규격입니다.
     * 미디어메시지 종류에 따라 3가지(standalone, carousel, template)로 전송 요청 할 수 있습니다.
     * 요청할 메시지 종류에 맞는 format ID(RCS messagebaseId)입력이 필요합니다.
     *
     * @param body - RCS Request
     * @returnsparam
     */
    async RCS(req) {
        return this.sendRequest(`${API_VERSION$1}/send/rcs`, req);
    }
    /**
     * Method: Alimtalk
     * Description: 카카오 비즈메시지 알림톡 발송 규격입니다.
     * @param body - Alimtalk Request
     * @returnsparam
     */
    async Alimtalk(body) {
        return this.sendRequest(`${API_VERSION$1}/send/alimtalk`, body);
    }
    /**
     * Method: Friendtalk
     * Description: 카카오 비즈메시지 친구톡 발송 규격입니다.
     * 채널이 등록 되어있는 수신자에게만 친구톡 전송이 가능합니다.
     * 친구톡 이미지 메시지를 전송할 경우 사전에 이미지 파일 등록(카카오 비즈메시지 센터)이 필요 합니다.
     *
     * @param body - Friendtalk Request
     * @returnsparam
     */
    async Friendtalk(body) {
        return this.sendRequest(`${API_VERSION$1}/send/friendtalk`, body);
    }
    /**
    * Method: BrandMessage
    * Description: 카카오 비즈메시지 브랜드메세지지 발송 규격입니다.
    * 채널이 등록 되어있는 수신자에게만 친구톡 전송이 가능합니다.
    * 친구톡 이미지 메시지를 전송할 경우 사전에 이미지 파일 등록(카카오 비즈메시지 센터)이 필요 합니다.
    *
    * @param body - Friendtalk Request
    * @returnsparam
    */
    async BrandMessage(body) {
        return this.sendRequest(`${API_VERSION$1}/send/brandmessage`, body);
    }
    /**
     * Method: OMNI
     * Description: 메시지 별로 Fallback을 순차적으로 처리해주는 통합메시지 발송 규격입니다.
     * 메시지 관련 상세 옵션필드를 모두 사용할 수 있는 전문가 방식 입니다.
     * 요청 당 최대 10개의 수신번호를 함께 전송할 수 있습니다.
     * 메시지 내용, 제목, 버튼 등에 치환문구를 활용하여 전송 할 수 있습니다.
     * 전체 메시지 정보를 입력하는 방식 또는 사전에 등록한 메시지 폼을 이용하는 방식, 총 2가지 방식 중 선택하여 전송하실 수 있습니다.
     *
     * @param body - OMNI (통합 메세지) Request
     * @returnsparam
     */
    async OMNI(body) {
        return this.sendRequest(`${API_VERSION$1}/send/omni`, body);
    }
    /**
     * Method: sendRequest
     * Description: 지정된 본문과 함께 지정된 URL로 요청을 보냅니다.
     * @param url - URL
     * @param body
     * @returnsparam
     */
    async sendRequest(url, body) {
        try {
            const response = await this.client.post(url, JSON.stringify(body));
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
     * @param error - AxiosError 또는 일반 오류
     */
    handleError(error) {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                console.error(`[API error]: ${error.response.status} ${error.response.statusText}`);
                console.error("Response data:", JSON.stringify(error.response.data, null, 2));
                console.error("Response headers:", JSON.stringify(error.response.headers, null, 2));
            }
            else if (error.request) {
                console.error("No response received:", error.request);
            }
            else {
                console.error('[API error]:', error.message);
            }
        }
        else {
            console.error('Unexpected error:', error);
        }
    }
}

class OMNI {
    /**
     * OMNI SDK의 인스턴스를 생성합니다.
     *
     * @param config - 인증, 메시지 전송, 폼 제출 등 설정 옵션입니다.
     */
    constructor(config) {
        const { baseURL, token, id, password } = config;
        if (!token) {
            this.auth = new Auth({ baseURL, id, password });
        }
        else {
            const param = { baseURL, token };
            this.initializeModules(param);
        }
    }
    /**
     * Initializes the modules with the provided parameters.
     *
     * @param param - The parameters including baseURL and token.
     */
    initializeModules(param) {
        this.file = new File(param);
        this.form = new Form(param);
        this.send = new Send(param);
        this.report = new Report(param);
        this.polling = new Polling(param);
        this.webhook = new Webhook(param);
    }
}

const API_VERSION = CONFIG.API_VERSION;
/**
 * Class: Auth
 * Description: OMNI 인증 token 을 발급합니다.
 */
class Auth {
    /**
     * Constructor: Auth
     * Description: 인증 헤더로 Axiox client 를 초기화 합니다.
     * @param options - baseURL, id, password.
     */
    constructor(options) {
        this.client = axios.create({
            baseURL: options.baseURL,
            headers: {
                'X-IB-Client-Id': options.id,
                'X-IB-Client-Passwd': options.password,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
        });
    }
    /**
     * Method: getToken
     * Description: 계정의 Token을 발급합니다.
     * @returns
     */
    async getToken() {
        try {
            const response = await this.client.post(`/${API_VERSION}/auth/token`);
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

// flatted 사용
function toJSON(json) {
    return stringify(json);
}

/**
 * 클래스: AuthOptionsBuilder
 * 설명: OMNI API 인증을 위한 AuthOption 빌더 클래스입니다.
 */
class AuthOptionsBuilder {
    constructor() {
        this.authOptions = {};
    }
    /** */
    setBaseURL(baseURL) {
        this.authOptions.baseURL = baseURL;
        return this;
    }
    setId(id) {
        this.authOptions.id = id;
        return this;
    }
    setPassword(password) {
        this.authOptions.password = password;
        return this;
    }
    build() {
        return this.authOptions;
    }
}

/**
 * 클래스: DefaultOptionsBuilder
 * 설명: OMNI API 사용을 위한 DefaultOption 빌더 클래스입니다.
 */
class DefaultOptionsBuilder {
    constructor() {
        this.defaultOptions = {};
    }
    setBaseURL(baseURL) {
        this.defaultOptions.baseURL = baseURL;
        return this;
    }
    setToken(token) {
        this.defaultOptions.token = token;
        return this;
    }
    build() {
        return this.defaultOptions;
    }
}

/**
 * 클래스: OMNIOptionsBuilder
 * 설명: OMNI API 인증 및 사용을 위한 OMNIOption 빌더 클래스입니다.
 */
class OMNIOptionsBuilder {
    constructor() {
        this.omniOptions = {};
    }
    setBaseURL(baseURL) {
        this.omniOptions.baseURL = baseURL;
        return this;
    }
    setId(id) {
        this.omniOptions.id = id;
        return this;
    }
    setPassword(password) {
        this.omniOptions.password = password;
        return this;
    }
    setToken(token) {
        this.omniOptions.token = token;
        return this;
    }
    build() {
        return this.omniOptions;
    }
}

/**
 * 클래스: FileRequestBodyBuilder
 * 설명: 메시지 발송에 필요한 이미지 파일을 등록하기 위한 FileRequestBody 빌더 클래스 입니다.
 */
class FileRequestBodyBuilder {
    constructor() {
        this.fileUploadRequest = {};
    }
    /** 이미지 파일 바이너리 설정 */
    setFile(file) {
        this.fileUploadRequest.file = file;
        return this;
    }
    /** FileUploadRequest 객체 생성 */
    build() {
        return this.fileUploadRequest;
    }
}

/**
 * 클래스: FormRequestBodyBuilder
 * 설명: FORM 등록/수정을 위한 FormRequestBody 빌더 클래스입니다.
 */
class FormRequestBodyBuilder {
    constructor() {
        this.formRequestBody = {};
    }
    /** 메시지 form 세부 사항 설정 (선택 사항) */
    setMessageForm(messageForm) {
        this.formRequestBody.messageForm = messageForm;
        return this;
    }
    /** FormRequestBody 객체 생성 */
    build() {
        return this.formRequestBody;
    }
}

class MessageFormBuilder {
    constructor() {
        this.messageForm = [];
    }
    /** SMS 메시지 세부 사항 설정 (선택 사항) */
    setSMS(sms) {
        if (sms) {
            this.messageForm.push({ sms });
        }
        return this;
    }
    /** MMS 메시지 세부 사항 설정 (선택 사항) */
    setMMS(mms) {
        if (mms) {
            this.messageForm.push({ mms });
        }
        return this;
    }
    /** RCS 메시지 세부 사항 설정 (선택 사항) */
    setRCS(rcs) {
        if (rcs) {
            this.messageForm.push({ rcs });
        }
        return this;
    }
    /** 카카오 알림톡 메시지 세부 사항 설정 (선택 사항) */
    setAlimtalk(alimtalk) {
        if (alimtalk) {
            this.messageForm.push({ alimtalk });
        }
        return this;
    }
    /** 카카오 친구톡 메시지 세부 사항 설정 (선택 사항) */
    setFriendtalk(friendtalk) {
        if (friendtalk) {
            this.messageForm.push({ friendtalk });
        }
        return this;
    }
    /** MessageForm 배열 생성 */
    build() {
        return this.messageForm;
    }
}

/**
 * 클래스: InternationalRequestBodyBuilder
 * 설명: 국제 문자 발송을 위한 InternationalRequestBody 빌더 클래스입니다.
 */
class InternationalRequestBodyBuilder {
    constructor() {
        this.internationalRequestBody = {
            from: '',
            to: '',
            text: '',
        };
    }
    /** 발신번호 설정 */
    setFrom(from) {
        this.internationalRequestBody.from = from;
        return this;
    }
    /** 수신번호 설정 */
    setTo(to) {
        this.internationalRequestBody.to = to;
        return this;
    }
    /** 메시지 내용 설정 (최대 90자) */
    setText(text) {
        if (text.length > 90) {
            throw new Error('Text length exceeds the maximum limit of 90 characters.');
        }
        this.internationalRequestBody.text = text;
        return this;
    }
    /** 참조필드 설정 (선택 사항, 최대 200자) */
    setRef(ref) {
        if (ref && ref.length > 200) {
            throw new Error('Ref length exceeds the maximum limit of 200 characters.');
        }
        this.internationalRequestBody.ref = ref;
        return this;
    }
    /** InternationalRequestBody 객체 생성 */
    build() {
        return this.internationalRequestBody;
    }
}

class AlimtalkAttachmentBuilder {
    constructor() {
        this.attachment = {};
    }
    /** 알림톡 버튼 정보 */
    setButton(button) {
        this.attachment.button = button;
        return this;
    }
    /** 알림톡 아이템 정보 */
    setItem(item) {
        this.attachment.item = item;
        return this;
    }
    /** 알림톡 아이템 하이라이트 정보 */
    setItemHighlight(itemHighlight) {
        this.attachment.itemHighlight = itemHighlight;
        return this;
    }
    build() {
        return this.attachment;
    }
}

/**
 * 클래스: AlimtalkBuilder
 * 설명: OMNI 통합 발송과 FORM 등록/수정을 위한 Alimtalk 빌더 클래스입니다.
 */
class AlimtalkBuilder {
    constructor() {
        this.alimtalk = {};
    }
    /** 카카오 비즈메시지 발신 프로필 키 */
    setSenderKey(senderKey) {
        this.alimtalk.senderKey = senderKey;
        return this;
    }
    /** 카카오 비즈메시지 타입 */
    setMsgType(msgType) {
        this.alimtalk.msgType = msgType;
        return this;
    }
    /** 알림톡 템플릿 코드 */
    setTemplateCode(templateCode) {
        this.alimtalk.templateCode = templateCode;
        return this;
    }
    /** 알림톡 내용 */
    setText(text) {
        this.alimtalk.text = text;
        return this;
    }
    /** 알림톡 제목(강조표기형 템플릿) */
    setTitle(title) {
        this.alimtalk.title = title;
        return this;
    }
    /** 첨부 정보 */
    setAttachment(attachment) {
        this.alimtalk.attachment = attachment;
        return this;
    }
    /** 부가 정보 */
    setSupplement(supplement) {
        this.alimtalk.supplement = supplement;
        return this;
    }
    /** 메시지 에 포함된 가격/금액/결제금액 */
    setPrice(price) {
        this.alimtalk.price = price;
        return this;
    }
    /** 메시지에 포함된 가격/금액/결제금액의 통화 단위 (국제 통화 코드 - KRW, USD, EUR) */
    setCurrencyType(currencyType) {
        this.alimtalk.currencyType = currencyType;
        return this;
    }
    build() {
        return this.alimtalk;
    }
}

class AlimtalkItemBuilder {
    constructor() {
        this.item = {};
    }
    /** 알림톡 아이템 리스트(2~10 개) */
    setList(list) {
        if (list.length < 2 || list.length > 10) {
            throw new Error('List must contain between 2 and 10 items.');
        }
        this.item.list = list;
        return this;
    }
    /** 알림톡 아이템 요약정보 */
    setSummary(summary) {
        this.item.summary = summary;
        return this;
    }
    build() {
        return this.item;
    }
}

class AlimtalkItemListBuilder {
    constructor() {
        this.itemList = {};
    }
    /** 알림톡 아이템 리스트 타이틀  */
    setTitle(title) {
        if (title.length > 6) {
            throw new Error('Title length exceeds the maximum limit of 6 characters.');
        }
        this.itemList.title = title;
        return this;
    }
    /** 알림톡 아이템 리스트 부가정보 */
    setDescription(description) {
        this.itemList.description = description;
        return this;
    }
    build() {
        return this.itemList;
    }
}

class AlimtalkRequestBodyBuilder {
    constructor() {
        this.alimtalkRequestBody = {};
    }
    /** 카카오 비즈메시지 발신 프로필 키 설정 */
    setSenderKey(senderKey) {
        this.alimtalkRequestBody.senderKey = senderKey;
        return this;
    }
    /** 카카오 알림톡메시지타입 설정 */
    setMsgType(msgType) {
        this.alimtalkRequestBody.msgType = msgType;
        return this;
    }
    /** 수신번호 설정 */
    setTo(to) {
        this.alimtalkRequestBody.to = to;
        return this;
    }
    /** 알림톡 템플릿 코드 설정 */
    setTemplateCode(templateCode) {
        this.alimtalkRequestBody.templateCode = templateCode;
        return this;
    }
    /** 알림톡 내용 설정 */
    setText(text) {
        this.alimtalkRequestBody.text = text;
        return this;
    }
    /** 카카오 버튼 정보 설정 (최대 5개) */
    setButton(button) {
        if (button && button.length > 5) {
            throw new Error('You can only add up to 5 buttons.');
        }
        this.alimtalkRequestBody.button = button;
        return this;
    }
    /** 참조필드 설정 (최대 200자, 선택 사항) */
    setRef(ref) {
        if (ref && ref.length > 200) {
            throw new Error('Ref length exceeds the maximum limit of 200 characters.');
        }
        this.alimtalkRequestBody.ref = ref;
        return this;
    }
    /** 실패 시 전송될 Fallback 메시지 정보 설정 (선택 사항) */
    setFallback(fallback) {
        this.alimtalkRequestBody.fallback = fallback;
        return this;
    }
    /** AlimtalkRequestBody 객체 생성 */
    build() {
        return this.alimtalkRequestBody;
    }
}

class AlimtalkSummaryBuilder {
    constructor() {
        this.summary = {};
    }
    /** 알림톡 아이템 요약정보 타이틀 (최대 길이 6) */
    setTitle(title) {
        if (title.length > 6) {
            throw new Error('Title length exceeds the maximum limit of 6 characters.');
        }
        this.summary.title = title;
        return this;
    }
    /** 알림톡 아이템 요약정보 설명  */
    setDescription(description) {
        this.summary.description = description;
        return this;
    }
    /** Summary 객체 생성 */
    build() {
        return this.summary;
    }
}

class AlimtalkSupplementBuilder {
    constructor() {
        this.supplement = {};
    }
    /** 바로연결 정보  */
    setQuickReply(quickReply) {
        this.supplement.quickReply = quickReply;
        return this;
    }
    build() {
        return this.supplement;
    }
}

/**
 * 클래스: BrandMEssageBuilder
 * 설명: OMNI 통합 발송과 FORM 등록/수정을 위한 BrandMessage 빌더 클래스입니다.
 */
class BrandMessageBuilder {
    constructor() {
        this.brandMessage = {};
    }
    /** 카카오 비즈메시지 발신 프로필 키 */
    setSenderKey(senderKey) {
        this.brandMessage.senderKey = senderKey;
        return this;
    }
    /** 카카오 브랜드 메시지 타입 (basic: 기본형, free: 자유형) */
    setSendType(sendType) {
        this.brandMessage.sendType = sendType;
        return this;
    }
    /** 카카오 비즈메시지 타입 */
    setMsgType(msgType) {
        this.brandMessage.msgType = msgType;
        return this;
    }
    /** 친구톡 내용 */
    setText(text) {
        this.brandMessage.text = text;
        return this;
    }
    /** 친구톡 내용 */
    setCarousel(carousel) {
        this.brandMessage.carousel = carousel;
        return this;
    }
    /** 첨부 정보 */
    setAttachment(attachment) {
        this.brandMessage.attachment = attachment;
        return this;
    }
    /** 헤더 정보
        (msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setHeader(header) {
        this.brandMessage.header = header;
        return this;
    }
    /** 헤더 정보
      (msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setTargeting(targeting) {
        this.brandMessage.targeting = targeting;
        return this;
    }
    /** 헤더 정보
  (msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setTemplateCode(templateCode) {
        this.brandMessage.templateCode = templateCode;
        return this;
    }
    /** 헤더 정보
(msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setAddtionalContent(addtionalContent) {
        this.brandMessage.addtionalContent = addtionalContent;
        return this;
    }
    setGroupTagKey(groupTagKey) {
        this.brandMessage.groupTagKey = groupTagKey;
        return this;
    }
    setAdult(adult) {
        this.brandMessage.adult = adult;
        return this;
    }
    setPushAlarm(pushAlarm) {
        this.brandMessage.pushAlarm = pushAlarm;
        return this;
    }
    setAdFlag(adFlag) {
        this.brandMessage.adFlag = adFlag;
        return this;
    }
    setMessageVariable(messageVariable) {
        this.brandMessage.messageVariable = messageVariable;
        return this;
    }
    setButtonVariable(buttonVariable) {
        this.brandMessage.buttonVariable = buttonVariable;
        return this;
    }
    setCouponVariable(couponVariable) {
        this.brandMessage.couponVariable = couponVariable;
        return this;
    }
    setImageVariable(imageVariable) {
        this.brandMessage.imageVariable = imageVariable;
        return this;
    }
    setVideoVariable(videoVariable) {
        this.brandMessage.videoVariable = videoVariable;
        return this;
    }
    setCommerceVariable(commerceVariable) {
        this.brandMessage.commerceVariable = commerceVariable;
        return this;
    }
    setCarouselVariable(carouselVariable) {
        this.brandMessage.carouselVariable = carouselVariable;
        return this;
    }
    setOriginCID(originCID) {
        this.brandMessage.originCID = originCID;
        return this;
    }
    setUnsubscribePhoneNumber(unsubscribePhoneNumber) {
        this.brandMessage.unsubscribePhoneNumber = unsubscribePhoneNumber;
        return this;
    }
    setUnsubscribeAuthNumber(unsubscribeAuthNumber) {
        this.brandMessage.unsubscribeAuthNumber = unsubscribeAuthNumber;
        return this;
    }
    build() {
        return this.brandMessage;
    }
}

class FriendtalkAttachmentBuilder {
    constructor() {
        this.attachment = {};
    }
    /** 버튼 목록
        msgType이 FT, FI이고 coupon을 적용할 경우 최대 4개 그 외 최대 5개  */
    setButton(button) {
        this.attachment.button = button;
        return this;
    }
    /** 이미지 msgType이 FM인 경우 필수  */
    setImage(image) {
        this.attachment.image = image;
        return this;
    }
    /** 와이드 리스트 요소  */
    setItem(item) {
        this.attachment.item = item;
        return this;
    }
    /** 쿠폰 요소 메세지 최하단 노출  */
    setCoupon(coupon) {
        this.attachment.coupon = coupon;
        return this;
    }
    /** 커머스 요소  */
    setCommerce(commerce) {
        this.attachment.commerce = commerce;
        return this;
    }
    /** 비디오 요소  */
    setVideo(video) {
        this.attachment.video = video;
        return this;
    }
    build() {
        return this.attachment;
    }
}

/**
 * 클래스: FriendtalkBuilder
 * 설명: OMNI 통합 발송과 FORM 등록/수정을 위한 Friendtalk 빌더 클래스입니다.
 */
class FriendtalkBuilder {
    constructor() {
        this.friendtalk = {};
    }
    /** 카카오 비즈메시지 발신 프로필 키 */
    setSenderKey(senderKey) {
        this.friendtalk.senderKey = senderKey;
        return this;
    }
    /** 카카오 비즈메시지 타입 */
    setMsgType(msgType) {
        this.friendtalk.msgType = msgType;
        return this;
    }
    /** 친구톡 내용 */
    setText(text) {
        this.friendtalk.text = text;
        return this;
    }
    /** 부가정보 (msgType이 FM인 경우 사용) */
    setAdditionalContent(additionalContent) {
        this.friendtalk.additionalContent = additionalContent;
        return this;
    }
    /** 광고성메시지 필수 표기 사항 노출 여부(Y(기본값)/N)
        (msgType이 FL, FC, FA인  경우  Y로만  발송 가능) */
    setAdFlag(adFlag) {
        this.friendtalk.adFlag = adFlag;
        return this;
    }
    /** 성인용 메시지 여부(Y/N(기본값)) */
    setAdult(adult) {
        this.friendtalk.adult = adult;
        return this;
    }
    /** 첨부 정보 */
    setAttachment(attachment) {
        this.friendtalk.attachment = attachment;
        return this;
    }
    /** 헤더 정보
        (msgType 이 FL 인  경우 필수, FP인 경우 옵션) */
    setHeader(header) {
        this.friendtalk.header = header;
        return this;
    }
    /** 캐로셀 정보 (msgType이 FC, FA 인 경우 필수) */
    setCarousel(carousel) {
        this.friendtalk.carousel = carousel;
        return this;
    }
    /** 그룹태그 등록으로 받은 그룹태그 키 */
    setGroupTagKey(groupTagKey) {
        this.friendtalk.groupTagKey = groupTagKey;
        return this;
    }
    /** 메시지 푸시 알람 발송 여부( Y(기본값) / N ) */
    setPushAlarm(pushAlarm) {
        this.friendtalk.pushAlarm = pushAlarm;
        return this;
    }
    build() {
        return this.friendtalk;
    }
}

/**
 * 클래스: FriendtalkCarouselBuilder
 * 설명: 카카오 비즈메시지 친구톡 캐로셀 정보를 나타냅니다.
 */
class FriendtalkCarouselBuilder {
    constructor() {
        this.carousel = {};
    }
    /** 캐로셀 인트로 정보
        (msgType이 FC인 경우 사용 불가) */
    setHead(head) {
        this.carousel.head = head;
        return this;
    }
    /** 캐로셀 아이템 리스트 (최소: 2, 최대: 10) */
    setList(list) {
        this.carousel.list = list;
        return this;
    }
    /** 더보기 버튼 정보 */
    setTail(tail) {
        this.carousel.tail = tail;
        return this;
    }
    build() {
        return this.carousel;
    }
}

/**
 * 클래스: FriendtalkCarouselHeadBuilder
 * 설명: 카카오 비즈메시지 친구톡 캐로셀의 헤더 정보를 나타냅니다.
 */
class FriendtalkCarouselHeadBuilder {
    constructor() {
        this.head = {};
    }
    /** 캐로셀 인트로 헤더 (최대 20자) */
    setHeader(header) {
        this.head.header = header;
        return this;
    }
    /** 캐로셀 인트로 내용 (최대 50자) */
    setContent(content) {
        this.head.content = content;
        return this;
    }
    /** 캐로셀 인트로 이미지 주소 */
    setImageUrl(imageUrl) {
        this.head.imageUrl = imageUrl;
        return this;
    }
    /** 모바일 환경에서 인트로 클릭 시 이동할 URL (URL 필드 중 하나라도 값이 있으면 필수) */
    setUrlMobile(urlMobile) {
        this.head.urlMobile = urlMobile;
        return this;
    }
    /** PC 환경에서 인트로 클릭 시 이동할 URL */
    setUrlPc(urlPc) {
        this.head.urlPc = urlPc;
        return this;
    }
    /** 모바일 Android 환경에서 인트로 클릭 시 실행할 application custom scheme */
    setSchemeAndroid(schemeAndroid) {
        this.head.schemeAndroid = schemeAndroid;
        return this;
    }
    /** 모바일 iOS 환경에서 인트로 클릭 시 실행할 application custom scheme */
    setSchemeIos(schemeIos) {
        this.head.schemeIos = schemeIos;
        return this;
    }
    build() {
        return this.head;
    }
}

/**
 * 클래스: FriendtalkCarouselListAttachmentBuilder
 * 설명: 카카오 비즈메시지 친구톡 캐로셀의 리스트 상세 첨부 정보를 나타냅니다.
 */
class FriendtalkCarouselListAttachmentBuilder {
    constructor() {
        this.attachment = {};
    }
    /** 버튼 목록 (msgType이 FT, FI일 때 coupon을 적용할 경우 최대 4개, 그 외 최대 5개) */
    setButton(button) {
        this.attachment.button = button;
        return this;
    }
    /** 캐로셀 썸네일 이미지 */
    setImage(image) {
        this.attachment.image = image;
        return this;
    }
    /** 쿠폰 요소 (캐로셀 최하단 노출) */
    setCoupon(coupon) {
        this.attachment.coupon = coupon;
        return this;
    }
    /** 커머스 요소 (msgType이 FA인 경우 필수, FC인 경우 사용 불가) */
    setCommerce(commerce) {
        this.attachment.commerce = commerce;
        return this;
    }
    build() {
        return this.attachment;
    }
}

/**
 * 클래스: FriendtalkCarouselListBuilder
 * 설명: 카카오 비즈메시지 친구톡 캐로셀의 리스트 정보를 나타냅니다.
 */
class FriendtalkCarouselListBuilder {
    constructor() {
        this.list = {};
    }
    /** 캐로셀 아이템 제목 (msgType이 FC인 경우 필수, FA인 경우 사용 불가, 최대 20자) */
    setHeader(header) {
        this.list.header = header;
        return this;
    }
    /** 캐로셀 아이템 메시지 (msgType이 FC인 경우 필수, FA인 경우 사용 불가, 최대 180자) */
    setMessage(message) {
        this.list.message = message;
        return this;
    }
    /** 부가 정보 (msgType이 FC인 경우 사용 불가, 최대 34자) */
    setAdditionalContent(additionalContent) {
        this.list.additionalContent = additionalContent;
        return this;
    }
    /** 캐로셀 첨부 정보 */
    setAttachment(attachment) {
        this.list.attachment = attachment;
        return this;
    }
    build() {
        return this.list;
    }
}

/**
 * 클래스: FriendtalkCarouselTailBuilder
 * 설명: 카카오 비즈메시지 친구톡 캐로셀의 더보기 정보를 나타냅니다.
 */
class FriendtalkCarouselTailBuilder {
    constructor() {
        this.tail = {};
    }
    /** PC 환경에서 버튼 클릭 시 이동할 URL */
    setUrlPc(urlPc) {
        this.tail.urlPc = urlPc;
        return this;
    }
    /** 모바일 환경에서 버튼 클릭 시 이동할 URL */
    setUrlMobile(urlMobile) {
        this.tail.urlMobile = urlMobile;
        return this;
    }
    /** 모바일 iOS 환경에서 버튼 클릭 시 실행할 application custom scheme */
    setSchemeIos(schemeIos) {
        this.tail.schemeIos = schemeIos;
        return this;
    }
    /** 모바일 Android 환경에서 버튼 클릭 시 실행할 application custom scheme */
    setSchemeAndroid(schemeAndroid) {
        this.tail.schemeAndroid = schemeAndroid;
        return this;
    }
    build() {
        return this.tail;
    }
}

class FriendtalkCommerceBuilder {
    constructor() {
        this.commerce = {};
    }
    /** 상품제목 (최대 30자) */
    setTitle(title) {
        this.commerce.title = title;
        return this;
    }
    /** 정상가격 (0 ~ 99,999,999) */
    setRegularPrice(regularPrice) {
        this.commerce.regularPrice = regularPrice;
        return this;
    }
    /** 할인가격 (0 ~ 99,999,999) */
    setDiscountPrice(discountPrice) {
        this.commerce.discountPrice = discountPrice;
        return this;
    }
    /** 할인율 할인가격 존재시 할인율, 정액할인가격 중 하나는 필수 (0 ~ 100) */
    setDiscountRate(discountRate) {
        this.commerce.discountRate = discountRate;
        return this;
    }
    /** 정액할인가격 할인가격 존재시 할인율, 정액할인가격 중 하나는 필수 (0 ~ 999,999) */
    setDiscountFixed(discountFixed) {
        this.commerce.discountFixed = discountFixed;
        return this;
    }
    build() {
        return this.commerce;
    }
}

class FriendtalkCouponBuilder {
    constructor() {
        this.coupon = {};
    }
    /** 와이드 리스트(최소:3, 최대:4)
        쿠폰 이름
        지원하는 형식
        - ${숫자}원 할인 쿠폰 (숫자: 1 ~ 99,999,999)
        - ${숫자}% 할인 쿠폰 (숫자: 1 ~ 100)
        - 배송비 할인 쿠폰
        - ${7자 이내} 무료 쿠폰
        - ${7자 이내} UP 쿠폰*/
    setTitle(title) {
        this.coupon.title = title;
        return this;
    }
    /** 쿠폰 상세 설명 chat_bubble_type이
        WIDE, WIDE_ITEM_LIST, PREMIUM_VIDEO 인 경우
        18자 제한 그 외 12자 제한 */
    setDescription(description) {
        this.coupon.description = description;
        return this;
    }
    /** pc 환경에서 쿠폰 클릭 시 이동할 url */
    setUrlPc(urlPc) {
        this.coupon.urlPc = urlPc;
        return this;
    }
    /** mobile 환경에서 쿠폰 클릭 시 이동할 url */
    setUrlMobile(urlMobile) {
        this.coupon.urlMobile = urlMobile;
        return this;
    }
    /** mobile android 환경에서 쿠폰 클릭 시 실행할 application custom scheme */
    setSchemeAndroid(schemeAndroid) {
        this.coupon.schemeAndroid = schemeAndroid;
        return this;
    }
    /** mobile ios 환경에서 쿠폰 클릭 시 실행할 application custom scheme */
    setSchemeIos(schemeIos) {
        this.coupon.schemeIos = schemeIos;
        return this;
    }
    build() {
        return this.coupon;
    }
}

class FriendtalkItemBuilder {
    constructor() {
        this.item = {};
    }
    /** 와이드 리스트 요소 */
    setList(list) {
        this.item.list = list;
        return this;
    }
    build() {
        return this.item;
    }
}

class FriendtalkItemListBuilder {
    constructor() {
        this.itemList = {};
    }
    /** 아이템 제목 */
    setTitle(title) {
        this.itemList.title = title;
        return this;
    }
    /** 아이템 이미지 URL */
    setImgUrl(imgUrl) {
        this.itemList.imgUrl = imgUrl;
        return this;
    }
    /** mobile android 환경에서 이미지 클릭 시 실행할 application custom scheme */
    setSchemeAndroid(schemeAndroid) {
        this.itemList.schemeAndroid = schemeAndroid;
        return this;
    }
    /** mobile ios 환경에서 이미지 클릭 시 실행할 application custom scheme */
    setSchemeIos(schemeIos) {
        this.itemList.schemeIos = schemeIos;
        return this;
    }
    /** mobile 환경에서 이미지 클릭 시 이동할 url */
    setUrlMobile(urlMobile) {
        this.itemList.urlMobile = urlMobile;
        return this;
    }
    /** pc 환경에서 이미지 클릭 시 이동할 url */
    setUrlPc(urlPc) {
        this.itemList.urlPc = urlPc;
        return this;
    }
    build() {
        return this.itemList;
    }
}

class FriendtalkRequestBodyBuilder {
    constructor() {
        this.friendtalkRequestBody = {};
    }
    /** 카카오 비즈메시지 발신 프로필 키 설정 */
    setSenderKey(senderKey) {
        this.friendtalkRequestBody.senderKey = senderKey;
        return this;
    }
    /** 카카오 친구톡 메시지타입 설정 */
    setMsgType(msgType) {
        this.friendtalkRequestBody.msgType = msgType;
        return this;
    }
    /** 수신번호 설정 */
    setTo(to) {
        this.friendtalkRequestBody.to = to;
        return this;
    }
    /** 친구톡 내용 설정 (최대 90자) */
    setText(text) {
        if (text.length > 90) {
            throw new Error('Text length exceeds the maximum limit of 90 characters.');
        }
        this.friendtalkRequestBody.text = text;
        return this;
    }
    /** 친구톡 이미지 URL 설정 */
    setImgUrl(imgUrl) {
        this.friendtalkRequestBody.imgUrl = imgUrl;
        return this;
    }
    /** 친구톡 버튼정보 설정 */
    setButton(button) {
        this.friendtalkRequestBody.button = button;
        return this;
    }
    /** 참조필드 설정 (최대 200자) */
    setRef(ref) {
        if (ref && ref.length > 200) {
            throw new Error('Ref length exceeds the maximum limit of 200 characters.');
        }
        this.friendtalkRequestBody.ref = ref;
        return this;
    }
    /** 실패 시 전송될 Fallback 메시지 정보 설정 */
    setFallback(fallback) {
        this.friendtalkRequestBody.fallback = fallback;
        return this;
    }
    /** FriendtalkRequestBody 객체 생성 */
    build() {
        return this.friendtalkRequestBody;
    }
}

class FriendtalkVideoBuilder {
    constructor() {
        this.video = {};
    }
    /** 카카오TV 동영상 URL */
    setVideoUrl(videoUrl) {
        this.video.videoUrl = videoUrl;
        return this;
    }
    /** 동영상 썸네일용 이미지 URL, 없는 경우 동영상 기본썸네일 사용
        thumbnail_url 필드 필수
        video_url이 비공개 동영상 */
    setThumbnailUrl(thumbnailUrl) {
        this.video.thumbnailUrl = thumbnailUrl;
        return this;
    }
    build() {
        return this.video;
    }
}

class KakaoButtonBuilder {
    constructor() {
        this.kakaoButton = {};
    }
    /** 카카오 버튼 종류 설정 */
    setType(type) {
        this.kakaoButton.type = type;
        return this;
    }
    /** 카카오 버튼 명 설정 */
    setName(name) {
        this.kakaoButton.name = name;
        return this;
    }
    /** PC 환경에서 버튼 클릭 시 이동할 URL 설정 */
    setUrlPc(urlPc) {
        this.kakaoButton.urlPc = urlPc;
        return this;
    }
    /** 모바일 환경에서 버튼 클릭 시 이동할 URL 설정 */
    setUrlMobile(urlMobile) {
        this.kakaoButton.urlMobile = urlMobile;
        return this;
    }
    /** iOS 환경에서 버튼 클릭 시 실행할 application custom scheme 설정 */
    setSchemeIos(schemeIos) {
        this.kakaoButton.schemeIos = schemeIos;
        return this;
    }
    /** Android 환경에서 버튼 클릭 시 실행할 application custom scheme 설정 */
    setSchemeAndroid(schemeAndroid) {
        this.kakaoButton.schemeAndroid = schemeAndroid;
        return this;
    }
    /** 버튼 type이 WL(웹 링크)일 경우 아웃링크 사용 설정 */
    setTarget(target) {
        this.kakaoButton.target = target;
        return this;
    }
    /** KakaoButton 객체 생성 */
    build() {
        return this.kakaoButton;
    }
}

/**
 * 클래스: MMSBuilder
 * 설명: OMNI 통합 발송과 FORM 등록/수정을 위한 MMS 빌더 클래스입니다.
 */
class MMSBuilder {
    constructor() {
        this.mms = {};
    }
    /** 발신번호 설정 */
    setFrom(from) {
        this.mms.from = from;
        return this;
    }
    /** MMS 메시지 내용 설정 (최대 2000바이트) */
    setText(text) {
        const textByteLength = new TextEncoder().encode(text).length;
        if (textByteLength > 2000) {
            throw new Error('Text length exceeds the maximum limit of 2000 bytes.');
        }
        this.mms.text = text;
        return this;
    }
    /** MMS 메시지 제목 설정 (최대 40바이트) */
    setTitle(title) {
        if (title) {
            const titleByteLength = new TextEncoder().encode(title).length;
            if (titleByteLength > 40) {
                throw new Error('Title length exceeds the maximum limit of 40 bytes.');
            }
            this.mms.title = title;
        }
        return this;
    }
    /** 파일 키 설정 (최대 3개) */
    setFileKey(fileKey) {
        if (fileKey && fileKey.length > 3) {
            throw new Error('You can only add up to 3 file keys.');
        }
        this.mms.fileKey = fileKey;
        return this;
    }
    /** 메시지 유효 시간 설정 (초), 기본값: 86400 */
    setTtl(ttl) {
        this.mms.ttl = ttl;
        return this;
    }
    /** 최초 발신사업자 식별코드 설정 (최대 길이 9) */
    setOriginCID(originCID) {
        if (originCID && originCID.length > 9) {
            throw new Error('OriginCID length exceeds the maximum limit of 9 characters.');
        }
        this.mms.originCID = originCID;
        return this;
    }
    /** MMS 객체 생성 */
    build() {
        return this.mms;
    }
}

/**
 * 클래스: MMSRequestBodyBuilder
 * 설명: MMS(LMS) 발송을 위한 MMSRequestBody 빌더 클래스입니다.
 */
class MMSRequestBodyBuilder {
    constructor() {
        this.mmsRequestBody = {
            from: '',
            to: '',
            text: '',
        };
    }
    /** 발신번호 설정 */
    setFrom(from) {
        this.mmsRequestBody.from = from;
        return this;
    }
    /** 수신번호 설정 */
    setTo(to) {
        this.mmsRequestBody.to = to;
        return this;
    }
    /** 메시지 내용 설정 (최대 2000 바이트) */
    setText(text) {
        const textByteLength = new TextEncoder().encode(text).length;
        if (textByteLength > 2000) {
            throw new Error('Text length exceeds the maximum limit of 2000 bytes.');
        }
        this.mmsRequestBody.text = text;
        return this;
    }
    /** 메시지 제목 설정 (선택 사항, 최대 40 바이트) */
    setTitle(title) {
        if (title) {
            const titleByteLength = new TextEncoder().encode(title).length;
            if (titleByteLength > 40) {
                throw new Error('Title length exceeds the maximum limit of 40 bytes.');
            }
            this.mmsRequestBody.title = title;
        }
        return this;
    }
    /** 파일 키 설정 (선택 사항, 최대 3개) */
    setFileKey(fileKey) {
        if (fileKey && fileKey.length > 3) {
            throw new Error('You can only add up to 3 file keys.');
        }
        this.mmsRequestBody.fileKey = fileKey;
        return this;
    }
    /** 참조필드 설정 (선택 사항, 최대 200 바이트) */
    setRef(ref) {
        if (ref) {
            const refByteLength = new TextEncoder().encode(ref).length;
            if (refByteLength > 200) {
                throw new Error('Ref length exceeds the maximum limit of 200 bytes.');
            }
            this.mmsRequestBody.ref = ref;
        }
        return this;
    }
    /** 최초 발신사업자 식별코드 설정 (선택 사항, 최대 9 바이트) */
    setOriginCID(originCID) {
        if (originCID) {
            const originCIDByteLength = new TextEncoder().encode(originCID).length;
            if (originCIDByteLength > 9) {
                throw new Error('OriginCID length exceeds the maximum limit of 9 bytes.');
            }
            this.mmsRequestBody.originCID = originCID;
        }
        return this;
    }
    build() {
        return this.mmsRequestBody;
    }
}

class DestinationBuilder {
    constructor() {
        this.destination = {};
    }
    /** 수신번호 설정 */
    setTo(to) {
        this.destination.to = to;
        return this;
    }
    /** 치환 문구 설정 (JSON) */
    setReplaceWords(replaceWords) {
        this.destination.replaceWords = replaceWords;
        return this;
    }
    /** Destinations 객체 생성 */
    build() {
        return this.destination;
    }
}

class MessageFlowBuilder {
    constructor() {
        this.messageFlow = [];
    }
    /** SMS 메시지 세부 사항 설정 (선택 사항) */
    setSMS(sms) {
        if (sms) {
            this.messageFlow.push({ sms });
        }
        return this;
    }
    /** MMS 메시지 세부 사항 설정 (선택 사항) */
    setMMS(mms) {
        if (mms) {
            this.messageFlow.push({ mms });
        }
        return this;
    }
    /** RCS 메시지 세부 사항 설정 (선택 사항) */
    setRCS(rcs) {
        if (rcs) {
            this.messageFlow.push({ rcs });
        }
        return this;
    }
    /** 카카오 알림톡 메시지 세부 사항 설정 (선택 사항) */
    setAlimtalk(alimtalk) {
        if (alimtalk) {
            this.messageFlow.push({ alimtalk });
        }
        return this;
    }
    /** 카카오 친구톡 메시지 세부 사항 설정 (선택 사항) */
    setFriendtalk(friendtalk) {
        if (friendtalk) {
            this.messageFlow.push({ friendtalk });
        }
        return this;
    }
    /** MessageForm 배열 생성 */
    build() {
        return this.messageFlow;
    }
}

class OMNIRequestBodyBuilder {
    constructor() {
        this.omniRequestBody = {};
    }
    /** 수신 정보 리스트 설정 (최대 10개) */
    setDestinations(destinations) {
        this.omniRequestBody.destinations = destinations;
        return this;
    }
    /** 메시지 정보 리스트 설정 */
    setMessageFlow(messageFlow) {
        this.omniRequestBody.messageFlow = messageFlow;
        return this;
    }
    /** 메시지 폼 ID 설정 */
    setMessageForm(messageForm) {
        this.omniRequestBody.messageForm = messageForm;
        return this;
    }
    /** 정산용 부서코드 설정 (최대 20자) */
    setPaymentCode(paymentCode) {
        this.omniRequestBody.paymentCode = paymentCode;
        return this;
    }
    /** 참조 필드 설정 (선택 사항) */
    setRef(ref) {
        this.omniRequestBody.ref = ref;
        return this;
    }
    /** OMNIRequestBody 객체 생성 */
    build() {
        return this.omniRequestBody;
    }
}

class CarouselContentBuilder {
    constructor() {
        this.carouselContent = {};
    }
    /** RCS 내용 */
    setText(text) {
        this.carouselContent.text = text;
        return this;
    }
    /** RCS 제목 */
    setTitle(title) {
        this.carouselContent.title = title;
        return this;
    }
    /** 미디어(maapfile://) */
    setMedia(media) {
        this.carouselContent.media = media;
        return this;
    }
    /** 클릭 시 랜딩 URL
        (값이 '\' 경우 이미지 전체보기) */
    setMediaUrl(mediaUrl) {
        this.carouselContent.mediaUrl = mediaUrl;
        return this;
    }
    /** 버튼 정보 */
    setButton(button) {
        this.carouselContent.button = button;
        return this;
    }
    build() {
        return this.carouselContent;
    }
}

/**
 * 클래스: ComTButtonBuilder
 * 설명: 대화방 열기 (문자) 메시지 App을 실행합니다. (COM_T)
 */
class ComTButtonBuilder {
    constructor() {
        this.button = { type: 'COM_T' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 대화방의 수신자 번호  */
    setPhoneNumber(phoneNumber) {
        this.button.phoneNumber = phoneNumber;
        return this;
    }
    /** 내용 */
    setText(text) {
        this.button.text = text;
        return this;
    }
    build() {
        return this.button;
    }
}

/**
 * 클래스: ComTButtonBuilder
 * 설명: 대화방 열기 (음성, 영상) 메시지 App을 실행합니다. (COM_V)
 */
class ComVButtonBuilder {
    constructor() {
        this.button = { type: 'COM_V' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 대화방의 수신자 번호 */
    setPhoneNumber(phoneNumber) {
        this.button.phoneNumber = phoneNumber;
        return this;
    }
    build() {
        return this.button;
    }
}

/**
 * 클래스: CopyButtonBuilder
 * 설명: 지정된 내용을 클립보드로 복사합니다. (COPY)
 */
class CopyButtonBuilder {
    constructor() {
        this.button = { type: 'COPY' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 클립보드로 복사될 내용 */
    setText(text) {
        this.button.text = text;
        return this;
    }
    build() {
        return this.button;
    }
}

/**
 * 클래스: DialButtonBuilder
 * 설명: 	특정 전화번호로 전화를 걸 수 있습니다. (DIAL)
 */
class DialButtonBuilder {
    constructor() {
        this.button = { type: 'DIAL' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 전화 연결 할 수신자 번호 */
    setPhoneNumber(phoneNumber) {
        this.button.phoneNumber = phoneNumber;
        return this;
    }
    build() {
        return this.button;
    }
}

/**
 * 클래스: MapLocButtonBuilder
 * 설명: 	지정된 좌표로 설정된 지도 App을 실행합니다. (MAP_LOC)
 */
class MapLocButtonBuilder {
    constructor() {
        this.button = { type: 'MAP_LOC' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 지도 App에 표시될 라벨명 */
    setLabel(label) {
        this.button.label = label;
        return this;
    }
    /** 위도 값(예)37.4001971 */
    setLatitude(latitude) {
        this.button.latitude = latitude;
        return this;
    }
    /** 경도 값 (예)127.1071718 */
    setLongitude(longitude) {
        this.button.longitude = longitude;
        return this;
    }
    /** 지도 App동작이 안 될 경우 대처할 URL */
    setFallbackUrl(fallbackUrl) {
        this.button.fallbackUrl = fallbackUrl;
        return this;
    }
    build() {
        return this.button;
    }
}

/**
 * 클래스: MapQryButtonBuilder
 * 설명: 검색어를 통해 조회된 지도 App을 실행합니다. (MAP_QRY)
 */
class MapQryButtonBuilder {
    constructor() {
        this.button = { type: 'MAP_QRY' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 지도 App에서 검색할 구문 */
    setQuery(query) {
        this.button.query = query;
        return this;
    }
    /** 지도 App동작이 안 될 경우 대처할 URL */
    setFallbackUrl(fallbackUrl) {
        this.button.fallbackUrl = fallbackUrl;
        return this;
    }
    build() {
        return this.button;
    }
}

/**
 * 클래스: MapSendButtonBuilder
 * 설명: 휴대폰의 현재 위치 정보를 전송합니다. (MAP_SEND)
 */
class MapSendButtonBuilder {
    constructor() {
        this.button = { type: 'MAP_SEND' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    build() {
        return this.button;
    }
}

class RCSBuilder {
    constructor() {
        this.rcs = {};
    }
    /** 발신번호 설정 */
    setFrom(from) {
        this.rcs.from = from;
        return this;
    }
    /** RCS 메시지 JSON 객체 설정 */
    setContent(content) {
        this.rcs.content = content;
        return this;
    }
    /** RCS 메시지 formatID 설정 */
    setFormatId(formatId) {
        this.rcs.formatId = formatId;
        return this;
    }
    /** Body 설정 */
    setBody(body) {
        this.rcs.body = body;
        return this;
    }
    /** Buttons 설정 */
    setButtons(buttons) {
        this.rcs.buttons = buttons;
        return this;
    }
    /** RCS 브랜드 키 설정 */
    setBrandKey(brandKey) {
        this.rcs.brandKey = brandKey;
        return this;
    }
    /** RCS 브랜드 ID 설정 */
    setBrandId(brandId) {
        this.rcs.brandId = brandId;
        return this;
    }
    /** RCS 메시지 그룹ID 설정 */
    setGroupId(groupId) {
        this.rcs.groupId = groupId;
        return this;
    }
    /** 전송 시간 초과 설정 (기본값: 1) */
    setExpiryOption(expiryOption) {
        this.rcs.expiryOption = expiryOption;
        return this;
    }
    /** 메시지 복사 허용 여부 설정 (기본값: 0) */
    setCopyAllowed(copyAllowed) {
        this.rcs.copyAllowed = copyAllowed;
        return this;
    }
    /** 메시지 상단 ‘광고’ 표출 여부 설정 (기본값: 0) */
    setHeader(header) {
        this.rcs.header = header;
        return this;
    }
    /** 메시지 하단 수신거부 번호 설정 */
    setFooter(footer) {
        this.rcs.footer = footer;
        return this;
    }
    /** 대행사ID 설정 (기본값: infobank) */
    setAgencyId(agencyId) {
        this.rcs.agencyId = agencyId;
        return this;
    }
    /** 대행사 키 설정 */
    setAgencyKey(agencyKey) {
        this.rcs.agencyKey = agencyKey;
        return this;
    }
    /** 메시지 유효 시간 설정 (초) (기본값: 86400) */
    setTtl(ttl) {
        this.rcs.ttl = ttl;
        return this;
    }
    /** RCS 객체 생성 */
    build() {
        return this.rcs;
    }
}

/**
 * 클래스: CalendarButtonBuilder
 * 설명: 정해진 일자와 내용으로 일정을 등록합니다. (CALENDAR)
 */
class CalendarButtonBuilder {
    constructor() {
        this.button = { type: 'CALENDAR' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 시작 일정(yyyy-MM-dd’T’HH:mm:ssXXX) */
    setStartTime(startTime) {
        this.button.startTime = startTime;
        return this;
    }
    /** 종료 일정(yyyy-MM-dd’T’HH:mm:ssXXX) */
    setEndTime(endTime) {
        this.button.endTime = endTime;
        return this;
    }
    /** 일정 제목 */
    setTitle(title) {
        this.button.title = title;
        return this;
    }
    /** 일정 내용 */
    setDescription(description) {
        this.button.description = description;
        return this;
    }
    build() {
        return this.button;
    }
}

/**
 * 클래스: URLButtonBuilder
 * 설명: Web page 또는 App으로 이동할 수 있습니다. (URL)
 */
class URLButtonBuilder {
    constructor() {
        this.button = { type: 'URL' };
    }
    /** 버튼 명 */
    setName(name) {
        this.button.name = name;
        return this;
    }
    /** 웹브라우저로 연결할 URL주소 */
    setUrl(url) {
        this.button.url = url;
        return this;
    }
    build() {
        return this.button;
    }
}

class RCSButtonBuilder {
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

class RCSContentBuilder {
    constructor() {
        this.rcsContent = {};
    }
    /** RCS 내용 standalone (content/body 중 하나는 필수 입력)  */
    setStandaloneContent(standalone) {
        this.rcsContent.standalone = standalone;
        return this;
    }
    /** RCS 내용 carousel (content/body 중 하나는 필수 입력)  */
    setCarouselContent(carousel) {
        this.rcsContent.carousel = carousel;
        return this;
    }
    /** RCS 내용 template (content/body 중 하나는 필수 입력)   */
    setTemplateContent(template) {
        this.rcsContent.template = template;
        return this;
    }
    build() {
        return this.rcsContent;
    }
}

/**
 * 클래스: RCSRequestBodyBuilder
 * 설명: RCSRequestBody 객체 생성을 위한 빌더 클래스입니다.
 */
class RCSRequestBodyBuilder {
    constructor() {
        this.rcsRequestBody = {};
    }
    /** RCS 메시지 JSON 객체 설정 */
    setContent(content) {
        this.rcsRequestBody.content = content;
        return this;
    }
    /** 발신번호 설정 */
    setFrom(from) {
        this.rcsRequestBody.from = from;
        return this;
    }
    /** 수신번호 설정 */
    setTo(to) {
        this.rcsRequestBody.to = to;
        return this;
    }
    /** RCS 메시지 formatID 설정 */
    setFormatId(formatId) {
        this.rcsRequestBody.formatId = formatId;
        return this;
    }
    /** Body 설정 */
    setBody(body) {
        this.rcsRequestBody.body = body;
        return this;
    }
    /** Buttons 설정 */
    setButtons(buttons) {
        this.rcsRequestBody.buttons = buttons;
        return this;
    }
    /** RCS 브랜드 키 설정 */
    setBrandKey(brandKey) {
        this.rcsRequestBody.brandKey = brandKey;
        return this;
    }
    /** RCS 브랜드 ID 설정 (선택 사항) */
    setBrandId(brandId) {
        this.rcsRequestBody.brandId = brandId;
        return this;
    }
    /** 전송 시간 초과 설정 (선택 사항) */
    setExpiryOption(expiryOption) {
        this.rcsRequestBody.expiryOption = expiryOption;
        return this;
    }
    /** 메시지 상단 ‘광고’ 표출 여부 설정 (선택 사항) */
    setHeader(header) {
        this.rcsRequestBody.header = header;
        return this;
    }
    /** 메시지 하단 수신거부 번호 설정 (선택 사항) */
    setFooter(footer) {
        const footerByteLength = new TextEncoder().encode(footer || '').length;
        if (footerByteLength > 100) {
            throw new Error('Footer length exceeds the maximum limit of 100 bytes.');
        }
        this.rcsRequestBody.footer = footer;
        return this;
    }
    /** 참조필드 설정 (선택 사항, 최대 200 바이트) */
    setRef(ref) {
        const refByteLength = new TextEncoder().encode(ref || '').length;
        if (refByteLength > 200) {
            throw new Error('Ref length exceeds the maximum limit of 200 bytes.');
        }
        this.rcsRequestBody.ref = ref;
        return this;
    }
    /** 실패 시 전송될 Fallback 메시지 설정 (선택 사항) */
    setFallback(fallback) {
        this.rcsRequestBody.fallback = fallback;
        return this;
    }
    /** RCSRequestBody 객체 생성 */
    build() {
        return this.rcsRequestBody;
    }
}

class StandaloneContentBuilder {
    constructor() {
        this.standaloneContent = {};
    }
    /** RCS 내용 */
    setText(text) {
        this.standaloneContent.text = text;
        return this;
    }
    /** RCS 제목 */
    setTitle(title) {
        this.standaloneContent.title = title;
        return this;
    }
    /** 미디어(maapfile://) */
    setMedia(media) {
        this.standaloneContent.media = media;
        return this;
    }
    /** 클릭 시 랜딩 URL (값이 '\' 경우 이미지 전체보기) */
    setMediaUrl(mediaUrl) {
        this.standaloneContent.mediaUrl = mediaUrl;
        return this;
    }
    /** 버튼 정보 */
    setButton(button) {
        this.standaloneContent.button = button;
        return this;
    }
    /** 서브 컨텐트 정보  */
    setSubContent(subContent) {
        this.standaloneContent.subContent = subContent;
        return this;
    }
    build() {
        return this.standaloneContent;
    }
}

class SubContentBuilder {
    constructor() {
        this.subContent = {};
    }
    /** 서브 소제목 */
    setSubTitle(subTitle) {
        this.subContent.subTitle = subTitle;
        return this;
    }
    /** 서브 소본문 */
    setSubDesc(subDesc) {
        this.subContent.subDesc = subDesc;
        return this;
    }
    /** 서브 이미지 */
    setSubMedia(subMedia) {
        this.subContent.subMedia = subMedia;
        return this;
    }
    /** 서브 이미지 URL */
    setSubMediaUrl(subMediaUrl) {
        this.subContent.subMediaUrl = subMediaUrl;
        return this;
    }
    build() {
        return this.subContent;
    }
}

class TemplateContentBuilder {
    constructor() {
        this.templateContent = {};
    }
    /** 템플릿 제목 */
    setTitle(title) {
        this.templateContent.title = title;
        return this;
    }
    /** 템플릿 본문 */
    setDescription(description) {
        this.templateContent.description = description;
        return this;
    }
    /** 서브 컨텐트 정보 */
    setSubContent(subContent) {
        this.templateContent.subContent = subContent;
        return this;
    }
    /** 사전에  등록된 key, value(JSON) */
    setCustomField(key, value) {
        this.templateContent[key] = value;
        return this;
    }
    build() {
        return this.templateContent;
    }
}

/**
 * 클래스: SMSBuilder
 * 설명: OMNI 통합 발송과 FORM 등록/수정을 위한 SMS 빌더 클래스입니다.
 */
class SMSBuilder {
    constructor() {
        this.sms = {};
    }
    /** 발신번호 설정 */
    setFrom(from) {
        this.sms.from = from;
        return this;
    }
    /** SMS 메시지 내용 설정 (최대 90바이트) */
    setText(text) {
        this.sms.text = text;
        return this;
    }
    /** 메시지 유효 시간 설정 (초), 기본값: 86400 */
    setTtl(ttl) {
        this.sms.ttl = ttl;
        return this;
    }
    /** 최초 발신사업자 식별코드 설정 (최대 길이 9) */
    setOriginCID(originCID) {
        this.sms.originCID = originCID;
        return this;
    }
    /** SMS 객체 생성 */
    build() {
        return this.sms;
    }
}

/**
 * 클래스: SMSRequestBodyBuilder
 * 설명: 국내 문자 발송을 위한 SMSRequestBody 빌더 클래스입니다.
 */
class SMSRequestBodyBuilder {
    constructor() {
        this.smsRequestBody = {
            from: '',
            to: '',
            text: '',
        };
    }
    /** 발신번호 설정 */
    setFrom(from) {
        this.smsRequestBody.from = from;
        return this;
    }
    /** 수신번호 설정 */
    setTo(to) {
        this.smsRequestBody.to = to;
        return this;
    }
    /** 메시지 내용 설정 (최대 90자) */
    setText(text) {
        this.smsRequestBody.text = text;
        return this;
    }
    /** 참조필드 설정 (선택 사항, 최대 200자) */
    setRef(ref) {
        this.smsRequestBody.ref = ref;
        return this;
    }
    /** 최초 발신사업자 식별코드 설정 (선택 사항, 최대 9자) */
    setOriginCID(originCID) {
        this.smsRequestBody.originCID = originCID;
        return this;
    }
    /** SMSRequestBody 객체 생성 */
    build() {
        return this.smsRequestBody;
    }
}

/**
 * 클래스: SMSRequestBodyBuilder
 * 설명: SMSRequestBody 객체 생성을 위한 빌더 클래스입니다.
 */
class FallbackBuilder {
    constructor() {
        this.fallback = {};
    }
    setType(type) {
        this.fallback.type = type;
        return this;
    }
    setFrom(type) {
        this.fallback.from = type;
        return this;
    }
    setText(text) {
        this.fallback.text = text;
        return this;
    }
    setTitle(title) {
        this.fallback.title = title;
        return this;
    }
    setFileKey(fileKey) {
        this.fallback.fileKey = fileKey;
        return this;
    }
    setOriginCID(originCID) {
        this.fallback.originCID = originCID;
        return this;
    }
    build() {
        return this.fallback;
    }
}

export { AlimtalkAttachmentBuilder, AlimtalkBuilder, AlimtalkItemBuilder, AlimtalkItemListBuilder, AlimtalkRequestBodyBuilder, AlimtalkSummaryBuilder, AlimtalkSupplementBuilder, Auth, AuthOptionsBuilder, BrandMessageBuilder, CarouselContentBuilder, ComTButtonBuilder, ComVButtonBuilder, CopyButtonBuilder, DefaultOptionsBuilder, DestinationBuilder, DialButtonBuilder, FallbackBuilder, File, FileRequestBodyBuilder, Form, FormRequestBodyBuilder, FriendtalkAttachmentBuilder, FriendtalkBuilder, FriendtalkCarouselBuilder, FriendtalkCarouselHeadBuilder, FriendtalkCarouselListAttachmentBuilder, FriendtalkCarouselListBuilder, FriendtalkCarouselTailBuilder, FriendtalkCommerceBuilder, FriendtalkCouponBuilder, FriendtalkItemBuilder, FriendtalkItemListBuilder, FriendtalkRequestBodyBuilder, FriendtalkVideoBuilder, InternationalRequestBodyBuilder, KakaoButtonBuilder, MMSBuilder, MMSRequestBodyBuilder, MapLocButtonBuilder, MapQryButtonBuilder, MapSendButtonBuilder, MessageFlowBuilder, MessageFormBuilder, OMNI, OMNIOptionsBuilder, OMNIRequestBodyBuilder, Polling, RCSBuilder, RCSButtonBuilder, RCSContentBuilder, RCSRequestBodyBuilder, Report, SMSBuilder, SMSRequestBodyBuilder, Send, StandaloneContentBuilder, SubContentBuilder, TemplateContentBuilder, Webhook, toJSON };
