import { DefaultOptions } from '../../../interfaces/config/Config';
import { FileRequestBody, FileUploadPathParameter } from "../../../interfaces/registration/file/FileRequestBody";
import { FileResponseBody } from "../../../interfaces/registration/file/FileResponseBody";
/**
 * Class: FileUpload
 * Description: 메시지 발송에 필요한 이미지 파일을 관리 합니다.
 */
export declare class File {
    private client;
    /**
     * Constructor: FileUpload
     * Description: 인증 헤더로 Axios client 를 초기화 합니다.
     * @param options - baseURL, token
     */
    constructor(options?: DefaultOptions);
    /**
     * Method: uploadFile
     * Description: 이미지 파일을 업로드 합니다.
     * @param fileUploadPathParameter - serviceType, msgType
     * @param fileUploadRequest - fileData
     * @returns
     */
    uploadFile(fileUploadPathParameter: FileUploadPathParameter, fileUploadRequest: FileRequestBody): Promise<FileResponseBody>;
    /**
     * Method: handleError
     * Description: 오류 세부 정보를 기록하여 API 오류를 처리합니다.
     * @param error
     */
    private handleError;
}
