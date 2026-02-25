const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const PayrollRecord = require('../models/PayrollRecord');

// ==================== 4대보험 계산 로직 ====================
// 2025년 기준 요율
const RATES = {
    national_pension: 0.045,       // 국민연금 직원부담 4.5%
    health_insurance: 0.03545,     // 건강보험 직원부담 3.545%
    long_term_care_rate: 0.1295,   // 장기요양보험료: 건강보험료의 12.95%
    employment_insurance: 0.009,   // 고용보험 직원부담 0.9%
    // 회사부담분
    employer_national_pension: 0.045,
    employer_health_insurance: 0.03545,
    employer_employment_insurance: 0.009,
    employer_accident_insurance: 0.007, // 산재보험 (회사 전액부담 ~0.7%)
};

// 소득세 간이세액표 (국세청 2025년 기준, 부양가족 수 포함)
// 부양가족 수(본인 포함): 기본 1인 기준
// 참고: 근로소득 간이세액표(조견표) 월 과세소득 → 세액 (1인 기준 후 부양가족 공제 적용)
function calcIncomeTax(taxableIncome, dependents = 1) {
    // 1단계: 1인 기준 산출세액 계산
    let tax = 0;
    if (taxableIncome <= 1060000) {
        tax = 0;
    } else if (taxableIncome <= 1500000) {
        tax = Math.round((taxableIncome - 1060000) * 0.06);
    } else if (taxableIncome <= 3000000) {
        tax = Math.round(26400 + (taxableIncome - 1500000) * 0.15);
    } else if (taxableIncome <= 4500000) {
        tax = Math.round(251400 + (taxableIncome - 3000000) * 0.24);
    } else if (taxableIncome <= 8000000) {
        tax = Math.round(611400 + (taxableIncome - 4500000) * 0.35);
    } else {
        tax = Math.round(1836400 + (taxableIncome - 8000000) * 0.38);
    }
    // 2단계: 부양가족 공제 (본인 포함 인원수 기준)
    // 국세청 간이세액표 공제액 (월 기준, 2025년)
    // 1인: 공제없음, 2인~: 인당 공제
    const deductionPerDependent = [
        0,        // 0인 (사용안함)
        0,        // 1인 (본인만) - 공제없음
        12500,    // 2인
        29160,    // 3인
        29160,    // 4인 (추가인원 동일)
        29160,    // 5인
    ];
    const idx = Math.min(dependents, deductionPerDependent.length - 1);
    const deduction = idx >= 2
        ? deductionPerDependent[2] + (idx - 2) * 29160
        : deductionPerDependent[idx] || 0;
    return Math.max(0, tax - deduction);
}

function calcPayroll(emp, overrides = {}) {
    const baseSalary = overrides.base_salary ?? emp.base_salary ?? 0;
    const mealAllowance = overrides.meal_allowance ?? emp.meal_allowance ?? 0;
    const carAllowance = overrides.car_allowance ?? emp.car_allowance ?? 0;
    const otherAllowance = overrides.other_allowance ?? emp.other_allowance ?? 0;

    const grossPay = baseSalary + mealAllowance + carAllowance + otherAllowance;

    // 과세소득 계산 (식대 20만원, 자가운전보조금 20만원 비과세)
    const taxFreeMeal = Math.min(mealAllowance, 200000);
    const taxFreeCar = Math.min(carAllowance, 200000);
    const taxableIncome = grossPay - taxFreeMeal - taxFreeCar;

    // 국민연금/건강보험 계산 기준
    // 신고소득월액이 있으면 그 기준으로, 없으면 기본급 기준
    const reportedIncome = overrides.reported_monthly_income ?? emp.reported_monthly_income;
    const pensionBase = reportedIncome ?? baseSalary;

    // 국민연금 (1000원 미만 절사)
    let nationalPension = overrides.national_pension_override
        ? (overrides.national_pension ?? 0)
        : Math.floor(pensionBase * RATES.national_pension / 1000) * 1000;

    // 건강보험 (10원 미만 절사)
    let healthInsurance = overrides.health_insurance_override
        ? (overrides.health_insurance ?? 0)
        : Math.floor(pensionBase * RATES.health_insurance / 10) * 10;

    // 장기요양보험료 (건강보험료 × 12.95%, 10원 미만 절사)
    const longTermCare = Math.floor(healthInsurance * RATES.long_term_care_rate / 10) * 10;

    // 고용보험: CEO이면 0원
    const employmentInsurance = emp.is_ceo
        ? 0
        : Math.floor(grossPay * RATES.employment_insurance / 10) * 10;

    // 소득세 (간이세액표, 부양가족 수: 기본 1인)
    const dependents = overrides.dependents ?? emp.dependents ?? 1;
    const incomeTax = calcIncomeTax(taxableIncome, dependents);
    // 지방소득세 (소득세의 10%, 1원 미만 절사)
    const localIncomeTax = Math.floor(incomeTax * 0.1);

    const totalDeduction = nationalPension + healthInsurance + longTermCare + employmentInsurance + incomeTax + localIncomeTax;
    const netPay = grossPay - totalDeduction;

    // 연봉 환산
    const annualGross = grossPay * 12;
    // 회사 부담 4대보험 (연간)
    const monthlyEmployerCost =
        Math.floor(pensionBase * RATES.employer_national_pension / 1000) * 1000 +
        Math.floor(pensionBase * RATES.employer_health_insurance / 10) * 10 +
        Math.floor(longTermCare * RATES.long_term_care_rate / 10) * 10 +
        (emp.is_ceo ? 0 : Math.floor(grossPay * RATES.employer_employment_insurance / 10) * 10) +
        Math.floor(grossPay * RATES.employer_accident_insurance / 10) * 10;
    const annualEmployerCost = annualGross + (monthlyEmployerCost * 12);

    return {
        base_salary: baseSalary,
        meal_allowance: mealAllowance,
        car_allowance: carAllowance,
        other_allowance: otherAllowance,
        gross_pay: grossPay,
        national_pension: nationalPension,
        health_insurance: healthInsurance,
        long_term_care: longTermCare,
        employment_insurance: employmentInsurance,
        income_tax: incomeTax,
        local_income_tax: localIncomeTax,
        total_deduction: totalDeduction,
        net_pay: netPay,
        annual_gross: annualGross,
        annual_employer_cost: annualEmployerCost,
        reported_monthly_income_used: reportedIncome ?? null,
        national_pension_override: overrides.national_pension_override ?? false,
        health_insurance_override: overrides.health_insurance_override ?? false,
    };
}

// ==================== 직원 관리 API ====================

// 직원 목록 조회
router.get('/employees', async (req, res) => {
    try {
        const employees = await Employee.find({ is_active: true }).sort({ employee_number: 1 });
        res.json({ success: true, data: employees });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 직원 전체 조회 (퇴사자 포함)
router.get('/employees/all', async (req, res) => {
    try {
        const employees = await Employee.find().sort({ employee_number: 1 });
        res.json({ success: true, data: employees });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 직원 단건 조회
router.get('/employees/:id', async (req, res) => {
    try {
        const emp = await Employee.findById(req.params.id);
        if (!emp) return res.status(404).json({ success: false, error: '직원을 찾을 수 없습니다.' });
        res.json({ success: true, data: emp });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 직원 등록
router.post('/employees', async (req, res) => {
    try {
        const emp = new Employee(req.body);
        await emp.save();
        res.json({ success: true, data: emp });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// 직원 수정
router.put('/employees/:id', async (req, res) => {
    try {
        const emp = await Employee.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!emp) return res.status(404).json({ success: false, error: '직원을 찾을 수 없습니다.' });
        res.json({ success: true, data: emp });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// 직원 삭제 (소프트)
router.delete('/employees/:id', async (req, res) => {
    try {
        const emp = await Employee.findByIdAndUpdate(req.params.id, { is_active: false, resignation_date: new Date() }, { new: true });
        if (!emp) return res.status(404).json({ success: false, error: '직원을 찾을 수 없습니다.' });
        res.json({ success: true, data: emp });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== 4대보험 자동계산 미리보기 ====================
router.post('/payroll/calculate', async (req, res) => {
    try {
        const { employee_id, overrides } = req.body;
        const emp = await Employee.findById(employee_id);
        if (!emp) return res.status(404).json({ success: false, error: '직원을 찾을 수 없습니다.' });
        const result = calcPayroll(emp, overrides || {});
        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==================== 급여 기록 API ====================

// 특정 월 급여 목록 조회
router.get('/payroll/:year/:month', async (req, res) => {
    try {
        const { year, month } = req.params;
        const records = await PayrollRecord.find({
            pay_year: parseInt(year),
            pay_month: parseInt(month)
        }).populate('employee_id').sort({ employee_number: 1 });
        res.json({ success: true, data: records });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 직원별 급여이력 조회
router.get('/payroll/history/:employee_id', async (req, res) => {
    try {
        const records = await PayrollRecord.find({ employee_id: req.params.employee_id })
            .sort({ pay_year: -1, pay_month: -1 });
        res.json({ success: true, data: records });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 특정 월 급여 단건 조회
router.get('/payroll/record/:id', async (req, res) => {
    try {
        const record = await PayrollRecord.findById(req.params.id).populate('employee_id');
        if (!record) return res.status(404).json({ success: false, error: '급여 기록을 찾을 수 없습니다.' });
        res.json({ success: true, data: record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 월 급여 일괄 생성 (해당 월 전체 직원 자동계산)
router.post('/payroll/generate', async (req, res) => {
    try {
        const { year, month } = req.body;
        if (!year || !month) return res.status(400).json({ success: false, error: 'year, month 필수' });

        const employees = await Employee.find({ is_active: true });
        const results = [];

        for (const emp of employees) {
            const existing = await PayrollRecord.findOne({ employee_id: emp._id, pay_year: year, pay_month: month });
            if (existing && existing.is_confirmed) {
                results.push({ employee: emp.name, status: '확정됨 - 건너뜀' });
                continue;
            }

            const calc = calcPayroll(emp, {});
            const data = {
                employee_id: emp._id,
                employee_number: emp.employee_number,
                employee_name: emp.name,
                position: emp.position,
                is_ceo: emp.is_ceo,
                pay_year: year,
                pay_month: month,
                ...calc
            };

            if (existing) {
                await PayrollRecord.findByIdAndUpdate(existing._id, data);
                results.push({ employee: emp.name, status: '업데이트' });
            } else {
                await PayrollRecord.create(data);
                results.push({ employee: emp.name, status: '생성' });
            }
        }

        res.json({ success: true, data: results });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 급여 기록 저장/수정 (수동 입력 포함)
router.post('/payroll/save', async (req, res) => {
    try {
        const { employee_id, year, month, overrides } = req.body;
        const emp = await Employee.findById(employee_id);
        if (!emp) return res.status(404).json({ success: false, error: '직원을 찾을 수 없습니다.' });

        const existing = await PayrollRecord.findOne({ employee_id, pay_year: year, pay_month: month });
        if (existing && existing.is_confirmed) {
            return res.status(400).json({ success: false, error: '확정된 급여는 수정할 수 없습니다.' });
        }

        const calc = calcPayroll(emp, overrides || {});
        const data = {
            employee_id: emp._id,
            employee_number: emp.employee_number,
            employee_name: emp.name,
            position: emp.position,
            is_ceo: emp.is_ceo,
            pay_year: year,
            pay_month: month,
            ...calc,
            notes: overrides?.notes || ''
        };

        let record;
        if (existing) {
            record = await PayrollRecord.findByIdAndUpdate(existing._id, data, { new: true });
        } else {
            record = await PayrollRecord.create(data);
        }

        res.json({ success: true, data: record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 급여 확정 처리
router.post('/payroll/confirm/:id', async (req, res) => {
    try {
        const record = await PayrollRecord.findByIdAndUpdate(req.params.id, { is_confirmed: true }, { new: true });
        if (!record) return res.status(404).json({ success: false, error: '급여 기록을 찾을 수 없습니다.' });
        res.json({ success: true, data: record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 급여 확정 취소
router.post('/payroll/unconfirm/:id', async (req, res) => {
    try {
        const record = await PayrollRecord.findByIdAndUpdate(req.params.id, { is_confirmed: false }, { new: true });
        if (!record) return res.status(404).json({ success: false, error: '급여 기록을 찾을 수 없습니다.' });
        res.json({ success: true, data: record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 급여 기록 삭제 (미확정만)
router.delete('/payroll/record/:id', async (req, res) => {
    try {
        const record = await PayrollRecord.findById(req.params.id);
        if (!record) return res.status(404).json({ success: false, error: '급여 기록을 찾을 수 없습니다.' });
        if (record.is_confirmed) return res.status(400).json({ success: false, error: '확정된 급여는 삭제할 수 없습니다.' });
        await PayrollRecord.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
