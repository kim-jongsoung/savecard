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

// 소득세 간이세액표 (국세청 2025년 근로소득 간이세액표 기준)
// 형식: [월과세소득하한, 1인, 2인, 3인, 4인, 5인] (단위: 원)
// 출처: 국세청 근로소득 간이세액표 (2025년 귀속)
const TAX_TABLE = [
    //  하한액      1인     2인     3인     4인     5인
    [    1060000,      0,      0,      0,      0,      0],
    [    1100000,   1560,      0,      0,      0,      0],
    [    1150000,   4340,      0,      0,      0,      0],
    [    1200000,   7160,      0,      0,      0,      0],
    [    1250000,   9980,      0,      0,      0,      0],
    [    1300000,  12800,      0,      0,      0,      0],
    [    1350000,  15620,      0,      0,      0,      0],
    [    1400000,  18440,      0,      0,      0,      0],
    [    1450000,  21260,      0,      0,      0,      0],
    [    1500000,  24080,      0,      0,      0,      0],
    [    1550000,  31860,  13440,      0,      0,      0],
    [    1600000,  39270,  19570,      0,      0,      0],
    [    1650000,  46680,  26000,      0,      0,      0],
    [    1700000,  54090,  32420,      0,      0,      0],
    [    1750000,  61500,  38850,      0,      0,      0],
    [    1800000,  68910,  45280,      0,      0,      0],
    [    1850000,  76320,  51700,   8630,      0,      0],
    [    1900000,  83730,  58130,  15880,      0,      0],
    [    1950000,  91140,  64550,  22300,      0,      0],
    [    2000000,  98550,  70980,  28720,      0,      0],
    [    2100000, 113360,  83830,  42380,      0,      0],
    [    2200000, 128180,  96690,  55240,  12930,      0],
    [    2300000, 143000, 109540,  68090,  25000,      0],
    [    2400000, 157810, 122390,  80940,  37850,      0],
    [    2500000, 172630, 135240,  93790,  50700,   8270],
    [    2600000, 187440, 148090, 106640,  63550,  20810],
    [    2700000, 202260, 160940, 119490,  76400,  33360],
    [    2800000, 217070, 173790, 132340,  89250,  46210],
    [    2900000, 231890, 186640, 145190, 102100,  59060],
    [    3000000, 246700, 199490, 158040, 114950,  71910],
    [    3100000, 266760, 214260, 170890, 127800,  84760],
    [    3200000, 287590, 231630, 183820, 140670,  97730],
    [    3300000, 308410, 249000, 196790, 153620, 110720],
    [    3400000, 329240, 266370, 209750, 166560, 123700],
    [    3500000, 350060, 283730, 222720, 179520, 136690],
    [    3600000, 370890, 301100, 235680, 192470, 149670],
    [    3700000, 391710, 318460, 248650, 205440, 162660],
    [    3800000, 412540, 335830, 261610, 218390, 175640],
    [    3900000, 433360, 353190, 274580, 231360, 188630],
    [    4000000, 454190, 370560, 287540, 244310, 201610],
    [    4500000, 558380, 457310, 356240, 311160, 268230],
    [    5000000, 682140, 560730, 440940, 395850, 352920],
    [    5500000, 826580, 680230, 540940, 495840, 452900],
    [    6000000, 971020, 810790, 665340, 615840, 572900],
    [    7000000,1259900,1065050, 919200, 869100, 826100],
    [    8000000,1548780,1319310,1173460,1122360,1079360],
    [   10000000,2211540,1961540,1811540,1761540,1711540],
];

function calcIncomeTax(taxableIncome, dependents = 1) {
    if (taxableIncome <= 1060000) return 0;
    // 부양가족 인덱스 (1~5인, 5인 초과는 5인으로 고정)
    const depIdx = Math.min(Math.max(dependents, 1), 5) - 1; // 0~4

    // 해당 소득 구간 찾기 (테이블은 해당 구간 이상~다음 구간 미만)
    let row = TAX_TABLE[0];
    for (let i = TAX_TABLE.length - 1; i >= 0; i--) {
        if (taxableIncome >= TAX_TABLE[i][0]) {
            row = TAX_TABLE[i];
            break;
        }
    }
    return row[depIdx + 1]; // 세액 (원)
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
router.post('/calculate', async (req, res) => {
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
router.get('/records/:year/:month', async (req, res) => {
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
router.get('/history/:employee_id', async (req, res) => {
    try {
        const records = await PayrollRecord.find({ employee_id: req.params.employee_id })
            .sort({ pay_year: -1, pay_month: -1 });
        res.json({ success: true, data: records });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 특정 월 급여 단건 조회
router.get('/record/:id', async (req, res) => {
    try {
        const record = await PayrollRecord.findById(req.params.id).populate('employee_id');
        if (!record) return res.status(404).json({ success: false, error: '급여 기록을 찾을 수 없습니다.' });
        res.json({ success: true, data: record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 월 급여 일괄 생성 (해당 월 전체 직원 자동계산)
router.post('/generate', async (req, res) => {
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
router.post('/save', async (req, res) => {
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
router.post('/confirm/:id', async (req, res) => {
    try {
        const record = await PayrollRecord.findByIdAndUpdate(req.params.id, { is_confirmed: true }, { new: true });
        if (!record) return res.status(404).json({ success: false, error: '급여 기록을 찾을 수 없습니다.' });
        res.json({ success: true, data: record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 급여 확정 취소
router.post('/unconfirm/:id', async (req, res) => {
    try {
        const record = await PayrollRecord.findByIdAndUpdate(req.params.id, { is_confirmed: false }, { new: true });
        if (!record) return res.status(404).json({ success: false, error: '급여 기록을 찾을 수 없습니다.' });
        res.json({ success: true, data: record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 급여 기록 삭제 (미확정만)
router.delete('/record/:id', async (req, res) => {
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
