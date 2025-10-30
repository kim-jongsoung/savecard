/**
 * 클래스: FileRequestBodyBuilder
 * 설명: 메시지 발송에 필요한 이미지 파일을 등록하기 위한 FileRequestBody 빌더 클래스 입니다.
 */
export class FileRequestBodyBuilder {
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
