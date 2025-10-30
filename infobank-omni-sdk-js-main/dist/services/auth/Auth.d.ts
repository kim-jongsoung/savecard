import { AuthOptions } from '../../interfaces/config/Config';
import { TokenResponseBody } from '../../interfaces/auth/AuthResponseBody';
/**
 * Class: Auth
 * Description: OMNI 인증 token 을 발급합니다.
 */
export declare class Auth {
    private client;
    /**
     * Constructor: Auth
     * Description: 인증 헤더로 Axiox client 를 초기화 합니다.
     * @param options - baseURL, id, password.
     */
    constructor(options: AuthOptions);
    /**
     * Method: getToken
     * Description: 계정의 Token을 발급합니다.
     * @returns
     */
    getToken(): Promise<TokenResponseBody>;
    /**
     * Method: handleError
     * Description: 오류 세부 정보를 기록하여 API 오류를 처리합니다.
     * @param error
     */
    private handleError;
}
