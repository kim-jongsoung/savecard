const mongoose = require('mongoose');

const payrollRecordSchema = new mongoose.Schema({
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    employee_number: { type: String, required: true },
    employee_name: { type: String, required: true },
    position: { type: String },
    is_ceo: { type: Boolean, default: false },

    // 지급 년월
    pay_year: { type: Number, required: true },   // 예: 2025
    pay_month: { type: Number, required: true },  // 예: 1~12

    // 지급 항목
    base_salary: { type: Number, default: 0 },         // 기본급
    meal_allowance: { type: Number, default: 0 },      // 식대
    car_allowance: { type: Number, default: 0 },       // 자가운전보조금
    other_allowance: { type: Number, default: 0 },     // 기타수당
    gross_pay: { type: Number, default: 0 },           // 지급합계

    // 4대보험 공제 항목
    national_pension: { type: Number, default: 0 },         // 국민연금 (직원부담분 4.5%)
    health_insurance: { type: Number, default: 0 },         // 건강보험 (직원부담분 3.545%)
    employment_insurance: { type: Number, default: 0 },     // 고용보험 (직원부담분 0.9%) - CEO는 0
    long_term_care: { type: Number, default: 0 },           // 장기요양보험료 (건강보험의 12.95%)
    income_tax: { type: Number, default: 0 },               // 소득세 (간이세액표 기준)
    local_income_tax: { type: Number, default: 0 },         // 지방소득세 (소득세의 10%)
    total_deduction: { type: Number, default: 0 },          // 공제합계

    // 실수령액
    net_pay: { type: Number, default: 0 },                  // 차인지급액

    // 수동 override 여부 (대표이사 등 수동 입력 시)
    national_pension_override: { type: Boolean, default: false },
    health_insurance_override: { type: Boolean, default: false },

    // 신고소득월액 (해당 월 적용값)
    reported_monthly_income_used: { type: Number, default: null },

    // 연봉 환산 정보 (투명한 정보 공개용)
    annual_gross: { type: Number, default: 0 },              // 세전 연봉 총액 (지급합계 × 12)
    annual_employer_cost: { type: Number, default: 0 },      // 회사 부담 총액 (연봉 + 회사부담 4대보험)

    notes: { type: String, default: '' },
    is_confirmed: { type: Boolean, default: false },         // 확정 여부 (확정 후 수정 불가)
}, {
    timestamps: true
});

// 복합 인덱스: 직원 + 년월 중복 방지
payrollRecordSchema.index({ employee_id: 1, pay_year: 1, pay_month: 1 }, { unique: true });

module.exports = mongoose.model('PayrollRecord', payrollRecordSchema);
