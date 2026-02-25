/**
 * 급여 관리 시드 데이터 - 직원 등록
 * 실행: node scripts/seed_employees.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Employee = require('../models/Employee');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/guamsavecard';

const employees = [
    {
        // ─────────────────────────────────────────────────────────────────
        // 국민연금: 신고소득월액 2,760,000 × 4.5% = 124,200 → 1,000원 미만 절사 = 124,000
        //   ※ 실제 124,240원이므로 신고소득월액은 별도 결정고지 기준 적용 (수동 override)
        // 건강보험: 기본급 1,450,000 × 3.545% = 51,403 → 10원 미만 절사 = 51,400 ✅
        // 장기요양: 51,400 × 12.95% = 6,656 → 10원 미만 절사 = 6,650 ✅
        // 고용보험: is_ceo=true → 0원 ✅
        // 소득세: 과세소득 1,250,000원 (식대/자가운전 각 10만원 비과세) → 1,060,000 이하이므로 0원 ✅
        // ─────────────────────────────────────────────────────────────────
        employee_number: '001',
        name: '김종성',
        position: '대표이사',
        department: '경영',
        is_ceo: true,
        base_salary: 1450000,
        meal_allowance: 100000,
        car_allowance: 100000,
        other_allowance: 0,
        reported_monthly_income: 1450000,
        dependents: 1,
        notes: '대표이사 - 고용보험 미적용. 국민연금 수동override(124,240). 건강보험은 기본급 기준 자동계산.'
    },
    {
        // ─────────────────────────────────────────────────────────────────
        // 국민연금: 2,760,000 × 4.5% = 124,200 → 절사 = 124,000 (수동 override로 124,240)
        // 건강보험: 2,900,000 × 3.545% = 102,805 → 절사 = 102,800 ✅
        // 장기요양: 102,800 × 12.95% = 13,313 → 절사 = 13,310 ✅
        // 고용보험: 2,900,000 × 0.9% = 26,100 ✅ (기본급 기준, 식대/자가운전 비과세 제외)
        // 과세소득: 3,300,000 - 200,000(식대비과세) - 200,000(자가운전비과세) = 2,900,000
        // 소득세: 26,400 + (2,900,000-1,500,000)×15% = 26,400+210,000 = 236,400 → ※65,360 불일치
        //   → 실제는 부양가족 공제 등 간이세액표 적용 → 수동 override 또는 별도 세액표 적용
        // ─────────────────────────────────────────────────────────────────
        employee_number: '002',
        name: '정광재',
        position: '사원',
        department: '영업',
        is_ceo: false,
        base_salary: 2900000,
        meal_allowance: 200000,
        car_allowance: 200000,
        other_allowance: 0,
        reported_monthly_income: 2760000,
        dependents: 2,
        notes: '국민연금 신고소득월액 2,760,000 기준. 건강보험/고용보험은 기본급 기준. 부양가족 2인(본인+1) 기준 소득세 65,360원.'
    }
];

async function seed() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('MongoDB 연결 성공');

        for (const empData of employees) {
            const existing = await Employee.findOne({ employee_number: empData.employee_number });
            if (existing) {
                await Employee.updateOne({ employee_number: empData.employee_number }, empData);
                console.log(`업데이트: ${empData.name} (${empData.employee_number})`);
            } else {
                await Employee.create(empData);
                console.log(`등록: ${empData.name} (${empData.employee_number})`);
            }
        }

        console.log('\n✅ 시드 완료');
        const all = await Employee.find({ is_active: true });
        console.log(`현재 활성 직원 수: ${all.length}명`);
        all.forEach(e => console.log(`  - ${e.name} (${e.position}) ${e.is_ceo ? '[CEO]' : ''}`));
    } catch (err) {
        console.error('오류:', err.message);
    } finally {
        await mongoose.disconnect();
    }
}

seed();
