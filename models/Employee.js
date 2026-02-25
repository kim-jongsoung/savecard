const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
    employee_number: { type: String, required: true, unique: true },  // 사원번호
    name: { type: String, required: true },                           // 성명
    position: { type: String, default: '' },                          // 직급
    department: { type: String, default: '' },                        // 부서
    hire_date: { type: Date },                                        // 입사일
    resignation_date: { type: Date },                                 // 퇴사일
    is_active: { type: Boolean, default: true },                      // 재직여부
    is_ceo: { type: Boolean, default: false },                        // 대표이사 여부

    // 기본 급여 항목 (기준값)
    base_salary: { type: Number, default: 0 },                        // 기본급
    meal_allowance: { type: Number, default: 0 },                     // 식대
    car_allowance: { type: Number, default: 0 },                      // 자가운전보조금
    other_allowance: { type: Number, default: 0 },                    // 기타수당

    // 4대보험 신고 기준소득 (대표이사 고정 신고 금액 적용 시)
    reported_monthly_income: { type: Number, default: null },         // 신고소득월액
    dependents: { type: Number, default: 1 },                        // 부양가족 수 (본인 포함, 소득세 간이세액표 적용)

    notes: { type: String, default: '' },                             // 비고
}, {
    timestamps: true
});

module.exports = mongoose.model('Employee', employeeSchema);
