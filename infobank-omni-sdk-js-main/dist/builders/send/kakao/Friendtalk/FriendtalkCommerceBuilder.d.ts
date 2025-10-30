import { Commerce } from "../../../../interfaces/send/kakao/Friendtalk/Friendtalk";
export declare class FriendtalkCommerceBuilder {
    private commerce;
    /** 상품제목 (최대 30자) */
    setTitle(title: string): this;
    /** 정상가격 (0 ~ 99,999,999) */
    setRegularPrice(regularPrice: number): this;
    /** 할인가격 (0 ~ 99,999,999) */
    setDiscountPrice(discountPrice: number): this;
    /** 할인율 할인가격 존재시 할인율, 정액할인가격 중 하나는 필수 (0 ~ 100) */
    setDiscountRate(discountRate: number): this;
    /** 정액할인가격 할인가격 존재시 할인율, 정액할인가격 중 하나는 필수 (0 ~ 999,999) */
    setDiscountFixed(discountFixed: number): this;
    build(): Commerce;
}
