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

    // 회계 분류
    category: {
        type: String,
        enum: [
            // 입금
            'deposit_trust',        // 수탁액 (출발 전 계약금/잔금)
            'deposit_receivable',   // 미수금 회수 (출발 후 수취)
            'deposit_refund',       // 환불 입금
            'deposit_insurance',    // 보험금 수령
            'deposit_other',        // 기타 입금
            // 출금
            'expense_salary',       // 급여
            'expense_ground',       // 지상비 (현지 행사비)
            'expense_prepaid',      // 선급금 (출발 전 지상비)
            'expense_unpaid',       // 미지급금 (출발 후 지상비)
            'expense_airfare',      // 항공료
            'expense_hotel',        // 숙박비
            'expense_transport',    // 차량/교통비
            'expense_meal',         // 식대
            'expense_entertainment',// 접대비
            'expense_insurance',    // 여행자보험
            'expense_marketing',    // 광고/마케팅비
            'expense_office',       // 사무용품/장비구매
            'expense_communication',// 통신비
            'expense_tax',          // 세금/공과금
            'expense_other',        // 기타경비
            'uncategorized',        // 미분류
        ],
        default: 'uncategorized'
    },

    // ERP 정산 연동 (차후 개발)
    linked_erp_type: { type: String, enum: ['hotel', 'package', 'none'], default: 'none' },
    linked_erp_id: { type: String, default: null },   // 연동된 정산 레코드 ID

    // 처리 상태
    is_confirmed: { type: Boolean, default: false },  // 회계 확정 여부
    notes: { type: String, default: '' },             // 메모

    // 입력 방법
    source: { type: String, enum: ['webhook', 'manual'], default: 'webhook' },
}, {
    timestamps: true
});

bankTransactionSchema.index({ account_number: 1, transaction_at: -1 });
bankTransactionSchema.index({ category: 1 });
bankTransactionSchema.index({ transaction_at: -1 });

module.exports = mongoose.model('BankTransaction', bankTransactionSchema);
