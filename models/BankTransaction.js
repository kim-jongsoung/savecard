const mongoose = require('mongoose');

const bankTransactionSchema = new mongoose.Schema({
    // 계좌 정보
    account_number: { type: String, required: true }, // 예: 140-013-623890
    account_alias: { type: String },                  // 예: 신한원화1
    currency: { type: String, default: 'KRW' },       // KRW | USD | JPY 등

    // 거래 정보
    type: { type: String, enum: ['in', 'out'], required: true }, // 입금 | 출금
    amount: { type: Number, required: true },
    balance_after: { type: Number, default: null },   // 거래 후 잔액 (문자에 포함 시)
    memo: { type: String, default: '' },              // 적요 (예: 2월급여정광재)

    // 거래 일시 (문자 파싱값)
    transaction_at: { type: Date, required: true },

    // 원본 문자메세지
    raw_message: { type: String, default: '' },

    // 회계 분류 (BankCategory.code 참조, enum 제약 없음 - DB에서 동적 관리)
    category: { type: String, default: 'uncategorized' },

    // ERP 정산 연동 (차후 개발)
    linked_erp_type: { type: String, enum: ['hotel', 'package', 'none'], default: 'none' },
    linked_erp_id: { type: String, default: null },   // 연동된 정산 레코드 ID

    // 처리 상태
    is_confirmed: { type: Boolean, default: false },  // 회계 확정 여부
    notes: { type: String, default: '' },             // 메모

    // 입력 방법
    source: { type: String, enum: ['webhook', 'manual', 'card'], default: 'webhook' },
}, {
    timestamps: true
});

bankTransactionSchema.index({ account_number: 1, transaction_at: -1 });
bankTransactionSchema.index({ category: 1 });
bankTransactionSchema.index({ transaction_at: -1 });

module.exports = mongoose.model('BankTransaction', bankTransactionSchema);
