const mongoose = require('mongoose');

const bankCategorySchema = new mongoose.Schema({
    // 카테고리 코드 (영문, 예: deposit_trust)
    code: { type: String, required: true, unique: true },

    // 표시명 (한국어)
    label: { type: String, required: true },

    // 입금(in) / 출금(out) / 공통(both)
    type: { type: String, enum: ['in', 'out', 'both'], required: true },

    // 부가세 관련
    vat_deductible: { type: Boolean, default: false }, // 매입세액공제 가능 여부 (출금 항목)
    vat_taxable:    { type: Boolean, default: false }, // 과세 대상 매출 여부 (입금 항목)

    // 자동 분류 키워드 (적요에 포함 시 자동 매핑)
    keywords: { type: [String], default: [] },

    // 정렬 순서
    sort_order: { type: Number, default: 0 },

    // 활성화 여부
    is_active: { type: Boolean, default: true },

    // 비고
    description: { type: String, default: '' },
}, {
    timestamps: true
});

bankCategorySchema.index({ type: 1, is_active: 1, sort_order: 1 });

module.exports = mongoose.model('BankCategory', bankCategorySchema);
