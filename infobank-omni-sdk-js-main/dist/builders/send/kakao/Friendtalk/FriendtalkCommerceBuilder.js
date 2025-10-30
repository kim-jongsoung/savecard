export class FriendtalkCommerceBuilder {
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
