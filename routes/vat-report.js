const express = require('express');
const router  = express.Router();
const VatReport     = require('../models/VatReport');
const BankTransaction = require('../models/BankTransaction');
const multer  = require('multer');
const upload  = multer({ storage: multer.memoryStorage() });

function requireAuth(req, res, next) {
    if (req.session && req.session.adminId) return next();
    res.status(401).json({ success: false, message: '인증이 필요합니다.' });
}

// 계좌분류 → 매입세액 공제 가능 여부
const DEDUCTIBLE_CATEGORIES = new Set([
    'expense_dev',
    'expense_marketing_fee',
    'expense_marketing',
    'expense_office',
    'expense_communication',
    'expense_entertainment',
    'expense_meal',
    'expense_other',
]);

const CATEGORY_LABELS = {
    expense_salary:        '급여',
    expense_ground:        '지상비',
    expense_airfare:       '항공료',
    expense_hotel:         '숙박비',
    expense_transport:     '차량/교통비',
    expense_meal:          '식대',
    expense_entertainment: '접대비',
    expense_insurance:     '여행자보험',
    expense_dev:           '개발수수료',
    expense_marketing_fee: '마케팅대행료',
    expense_marketing:     '광고/마케팅비',
    expense_advance:       '가지급금',
    expense_office:        '사무용품/장비',
    expense_communication: '통신비',
    expense_tax:           '세금/공과금',
    expense_other:         '기타경비',
};

// ==================== 페이지 렌더링 ====================
router.get('/', requireAuth, (req, res) => {
    res.render('admin/vat-report', {
        title: '부가세 신고',
        adminUsername: req.session.adminUsername,
        currentPage: 'vat-report',
    });
});

// ==================== 월별 리포트 조회/생성 ====================
router.get('/report/:year/:month', requireAuth, async (req, res) => {
    try {
        const year  = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const half  = month <= 6 ? 1 : 2;

        let report = await VatReport.findOne({ year, month });
        if (!report) {
            report = new VatReport({ year, month, half });
        }

        // 계좌분류 자동집계 (출금 항목만)
        const startDate = new Date(year, month - 1, 1);
        const endDate   = new Date(year, month, 1);

        const bankAgg = await BankTransaction.aggregate([
            {
                $match: {
                    type: 'out',
                    transaction_at: { $gte: startDate, $lt: endDate },
                    category: { $ne: 'uncategorized' },
                }
            },
            {
                $group: {
                    _id: '$category',
                    total_amount: { $sum: '$amount' },
                    count: { $sum: 1 },
                }
            }
        ]);

        report.bank_purchase_items = bankAgg.map(row => {
            const deductible = DEDUCTIBLE_CATEGORIES.has(row._id);
            const tax_amount = deductible ? Math.round(row.total_amount / 11) : 0;
            return {
                category:     row._id,
                label:        CATEGORY_LABELS[row._id] || row._id,
                total_amount: row.total_amount,
                tax_amount,
                deductible,
                count:        row.count,
            };
        });

        report.bank_deductible_tax = report.bank_purchase_items
            .filter(i => i.deductible)
            .reduce((s, i) => s + i.tax_amount, 0);

        // 역발급 세액 합계
        report.reverse_tax_total = (report.reverse_invoices || [])
            .reduce((s, i) => s + (i.tax_amount || 0), 0);

        // 카드 공제 합계
        report.card_deductible_tax = (report.card_expenses || [])
            .filter(c => c.deductible)
            .reduce((s, c) => s + (c.tax_amount || 0), 0);

        // 총 매입세액
        report.total_purchase_tax = report.bank_deductible_tax
            + report.card_deductible_tax
            + report.reverse_tax_total;

        // 납부세액
        report.tax_payable = report.sales_tax - report.total_purchase_tax;

        res.json({ success: true, data: report });
    } catch (e) {
        console.error('VAT report 조회 실패:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 리포트 저장 ====================
router.post('/report/:year/:month', requireAuth, async (req, res) => {
    try {
        const year  = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const half  = month <= 6 ? 1 : 2;

        const {
            sales_base, sales_tax,
            reverse_invoices, card_expenses,
            status, notes,
        } = req.body;

        let report = await VatReport.findOne({ year, month });
        if (!report) report = new VatReport({ year, month, half });

        if (sales_base  !== undefined) report.sales_base  = sales_base;
        if (sales_tax   !== undefined) report.sales_tax   = sales_tax;
        if (reverse_invoices) report.reverse_invoices = reverse_invoices;
        if (card_expenses)    report.card_expenses    = card_expenses;
        if (status)  report.status   = status;
        if (notes !== undefined) report.notes = notes;
        report.saved_by = req.session.adminUsername || '관리자';

        // 역발급 합계 재계산
        report.reverse_tax_total = (report.reverse_invoices || [])
            .reduce((s, i) => s + (i.tax_amount || 0), 0);

        // 카드 공제 재계산
        report.card_deductible_tax = (report.card_expenses || [])
            .filter(c => c.deductible)
            .reduce((s, c) => s + (c.tax_amount || 0), 0);

        // 계좌분류 재집계
        const startDate = new Date(year, month - 1, 1);
        const endDate   = new Date(year, month, 1);
        const bankAgg   = await BankTransaction.aggregate([
            { $match: { type: 'out', transaction_at: { $gte: startDate, $lt: endDate }, category: { $ne: 'uncategorized' } } },
            { $group: { _id: '$category', total_amount: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);
        report.bank_purchase_items = bankAgg.map(row => {
            const deductible = DEDUCTIBLE_CATEGORIES.has(row._id);
            const tax_amount = deductible ? Math.round(row.total_amount / 11) : 0;
            return { category: row._id, label: CATEGORY_LABELS[row._id] || row._id, total_amount: row.total_amount, tax_amount, deductible, count: row.count };
        });
        report.bank_deductible_tax = report.bank_purchase_items.filter(i => i.deductible).reduce((s, i) => s + i.tax_amount, 0);

        report.total_purchase_tax = report.bank_deductible_tax + report.card_deductible_tax + report.reverse_tax_total;
        report.tax_payable = (report.sales_tax || 0) - report.total_purchase_tax;

        await report.save();
        res.json({ success: true, data: report });
    } catch (e) {
        console.error('VAT report 저장 실패:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 역발급 계산서 추가 ====================
router.post('/report/:year/:month/reverse-invoice', requireAuth, async (req, res) => {
    try {
        const year  = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const half  = month <= 6 ? 1 : 2;

        let report = await VatReport.findOne({ year, month });
        if (!report) report = new VatReport({ year, month, half });

        const { date, supplier_name, total_amount, supply_amount, tax_amount, notes } = req.body;
        report.reverse_invoices.push({ date, supplier_name, total_amount, supply_amount, tax_amount, notes: notes || '' });
        report.reverse_tax_total = report.reverse_invoices.reduce((s, i) => s + (i.tax_amount || 0), 0);
        report.total_purchase_tax = report.bank_deductible_tax + report.card_deductible_tax + report.reverse_tax_total;
        report.tax_payable = (report.sales_tax || 0) - report.total_purchase_tax;

        await report.save();
        res.json({ success: true, data: report });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 역발급 계산서 삭제 ====================
router.delete('/report/:year/:month/reverse-invoice/:invoiceId', requireAuth, async (req, res) => {
    try {
        const year  = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const report = await VatReport.findOne({ year, month });
        if (!report) return res.status(404).json({ success: false, message: '리포트 없음' });

        report.reverse_invoices = report.reverse_invoices.filter(i => i._id.toString() !== req.params.invoiceId);
        report.reverse_tax_total = report.reverse_invoices.reduce((s, i) => s + (i.tax_amount || 0), 0);
        report.total_purchase_tax = report.bank_deductible_tax + report.card_deductible_tax + report.reverse_tax_total;
        report.tax_payable = (report.sales_tax || 0) - report.total_purchase_tax;

        await report.save();
        res.json({ success: true, data: report });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 법인카드 엑셀 업로드 파싱 ====================
router.post('/report/:year/:month/upload-card', requireAuth, upload.single('file'), async (req, res) => {
    try {
        const year  = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const half  = month <= 6 ? 1 : 2;

        if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });

        // CSV/TSV 파싱 (신한카드: 탭 구분, EUC-KR or UTF-8, 금액에 ₩ 및 쉼표 포함)
        // 인코딩 감지: UTF-8 BOM 없으면 EUC-KR 시도
        let rawContent;
        const buf = req.file.buffer;
        // UTF-8 BOM 있거나 UTF-8 유효하면 UTF-8, 아니면 latin1(바이트 보존 후 iconv로 변환)
        const hasUtf8Bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
        if (hasUtf8Bom) {
            rawContent = buf.toString('utf-8').replace(/^\uFEFF/, '');
        } else {
            // EUC-KR 파일을 latin1(binary)로 읽어 iconv-lite로 디코딩
            try {
                const iconv = require('iconv-lite');
                rawContent = iconv.decode(buf, 'euc-kr');
            } catch(e) {
                rawContent = buf.toString('utf-8');
            }
        }
        rawContent = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines   = rawContent.split('\n').map(l => l.trim()).filter(Boolean);
        console.log('[CARD_CSV] lines[0]:', lines[0], '| lines[1]:', lines[1]);

        // 구분자 자동 감지: 탭이 더 많으면 탭, 아니면 쉼표
        const sampleLine = lines[1] || lines[0] || '';
        const delimiter  = (sampleLine.split('\t').length > sampleLine.split(',').length) ? '\t' : ',';

        // quoted CSV 파서 (쉼표 구분자일 때 "7,000" 처리)
        function parseCSVLine(line, sep) {
            if (sep === '\t') return line.split('\t').map(c => c.trim());
            const result = [];
            let cur = '', inQuote = false;
            for (let ci = 0; ci < line.length; ci++) {
                const ch = line[ci];
                if (ch === '"') { inQuote = !inQuote; }
                else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
                else { cur += ch; }
            }
            result.push(cur.trim());
            return result;
        }

        // 금액 문자열 → 숫자 (₩, 쉼표, 공백 제거)
        function parseAmount(str) {
            return parseInt((str || '0').replace(/[^\d]/g, '')) || 0;
        }

        const parsed = [];
        // 헤더 행 스킵 (첫 행)
        for (let i = 1; i < lines.length; i++) {
            const cols = parseCSVLine(lines[i], delimiter);
            if (cols.length < 3) continue;

            // 신한법인카드 형식: 이용일 / 가맹점명 / 결제금액 / 공급가액 / 부가세공제 (탭 구분)
            const dateStr   = cols[0];
            const merchant  = cols[1] || '';
            const amount    = parseAmount(cols[2]);
            // 공급가액·부가세가 있으면 그대로 사용, 없으면 역산
            const supplyAmt = cols[3] ? parseAmount(cols[3]) : Math.round(amount / 1.1);
            const taxAmt    = cols[4] ? parseAmount(cols[4]) : (amount - supplyAmt);
            const cardNum   = cols[5] ? cols[5].replace(/[^0-9*]/g, '').slice(-4) : '';

            if (i <= 3) console.log(`[CARD_ROW${i}] cols:`, JSON.stringify(cols), '| amount:', amount, '| supply:', supplyAmt, '| tax:', taxAmt);

            if (!dateStr || amount === 0) continue;

            // 날짜 파싱 (YYYY-MM-DD or YYYY/MM/DD or YYYYMMDD or "MM. DD.")
            let cleanDate = dateStr.replace(/\//g, '-').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
            // "01. 01." 형식 처리 → 업로드한 연도/월 사용
            if (/^\d{2}\.\s*\d{2}\.$/.test(cleanDate)) {
                const parts = cleanDate.match(/(\d{2})\.\s*(\d{2})\./);
                cleanDate = `${year}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
            }
            const date = new Date(cleanDate);
            if (isNaN(date)) { console.log('[CARD_DATE_SKIP] invalid date:', dateStr, '→', cleanDate); continue; }

            parsed.push({ date, merchant, amount, supply_amount: supplyAmt, tax_amount: taxAmt, category: '', deductible: true, card_number: cardNum, notes: '' });
        }

        let report = await VatReport.findOne({ year, month });
        if (!report) report = new VatReport({ year, month, half });

        // 기존 카드 내역에 추가 (중복 방지: 날짜+가맹점+금액 동일하면 스킵)
        const existingKeys = new Set(report.card_expenses.map(c => `${c.date?.toISOString()?.slice(0,10)}_${c.merchant}_${c.amount}`));
        let added = 0;
        for (const item of parsed) {
            const key = `${item.date.toISOString().slice(0,10)}_${item.merchant}_${item.amount}`;
            if (!existingKeys.has(key)) {
                report.card_expenses.push(item);
                existingKeys.add(key);
                added++;
            }
        }

        report.card_deductible_tax = report.card_expenses.filter(c => c.deductible).reduce((s, c) => s + (c.tax_amount || 0), 0);
        report.total_purchase_tax  = report.bank_deductible_tax + report.card_deductible_tax + report.reverse_tax_total;
        report.tax_payable = (report.sales_tax || 0) - report.total_purchase_tax;

        await report.save();
        res.json({ success: true, added, total: report.card_expenses.length, data: report });
    } catch (e) {
        console.error('카드 업로드 실패:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 카드 항목 공제여부 토글 ====================
router.put('/report/:year/:month/card/:cardId', requireAuth, async (req, res) => {
    try {
        const year  = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const report = await VatReport.findOne({ year, month });
        if (!report) return res.status(404).json({ success: false });

        const item = report.card_expenses.id(req.params.cardId);
        if (!item) return res.status(404).json({ success: false, message: '항목 없음' });

        if (req.body.deductible !== undefined) item.deductible = req.body.deductible;
        if (req.body.category   !== undefined) item.category   = req.body.category;
        if (req.body.notes      !== undefined) item.notes      = req.body.notes;

        report.card_deductible_tax = report.card_expenses.filter(c => c.deductible).reduce((s, c) => s + (c.tax_amount || 0), 0);
        report.total_purchase_tax  = report.bank_deductible_tax + report.card_deductible_tax + report.reverse_tax_total;
        report.tax_payable = (report.sales_tax || 0) - report.total_purchase_tax;

        await report.save();
        res.json({ success: true, data: report });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 연도별 리포트 목록 ====================
router.get('/list/:year', requireAuth, async (req, res) => {
    try {
        const year = parseInt(req.params.year);
        const list = await VatReport.find({ year }).sort({ month: 1 }).lean();
        res.json({ success: true, data: list });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
