import { Video } from "../../../../interfaces/send/kakao/Friendtalk/Friendtalk";
export declare class FriendtalkVideoBuilder {
    private video;
    /** 카카오TV 동영상 URL */
    setVideoUrl(videoUrl: string): this;
    /** 동영상 썸네일용 이미지 URL, 없는 경우 동영상 기본썸네일 사용
        thumbnail_url 필드 필수
        video_url이 비공개 동영상 */
    setThumbnailUrl(thumbnailUrl: string): this;
    build(): Video;
}
