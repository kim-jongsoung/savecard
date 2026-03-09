const express = require('express');
const router = express.Router();
const BankTransaction = require('../models/BankTransaction');
const BankCategory = require('../models/BankCategory');
const multer = require('multer');
const XLSX = require('xlsx');

// text/plain body 파싱 지원
router.use(express.text({ type: 'text/plain' }));

// multer 메모리 저장소 (엑셀 업로드용)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 등록된 계좌 목록 (계좌번호 → 별칭/통화)
const ACCOUNTS = {
    '140-013-623890': { alias: '신한원화1', currency: 'KRW' },
    '140-014-014440': { alias: '신한원화2', currency: 'KRW' },
    '140-014-174143': { alias: '신한원화3', currency: 'KRW' },
    '180-011-678887': { alias: '신한외환',  currency: 'USD' },
};

// 자동 분류 키워드 룰
const AUTO_CATEGORY_RULES = [
    // 입금
    { keywords: ['계약금','예약금','입금확인','입금완료'], type: 'in',  category: 'deposit_trust' },
    { keywords: ['미수','잔금수령'],                       type: 'in',  category: 'deposit_receivable' },
    { keywords: ['환불','반환'],                           type: 'in',  category: 'deposit_refund' },
    { keywords: ['보험금','보상금'],                       type: 'in',  category: 'deposit_insurance' },
    // 출금
    { keywords: ['급여','salary','페이'],                  type: 'out', category: 'expense_salary' },
    { keywords: ['항공','airfare','air','kkk','대한항공','아시아나','제주항공'], type: 'out', category: 'expense_airfare' },
    { keywords: ['호텔','hotel','숙박','리조트'],           type: 'out', category: 'expense_hotel' },
    { keywords: ['지상비','랜드','행사비'],                 type: 'out', category: 'expense_ground' },
    { keywords: ['교통','차량','택시','버스'],              type: 'out', category: 'expense_transport' },
    { keywords: ['식대','점심','저녁','밥','커피','카페'],  type: 'out', category: 'expense_meal' },
    { keywords: ['접대','골프','선물'],                    type: 'out', category: 'expense_entertainment' },
    { keywords: ['보험','여행자보험'],                     type: 'out', category: 'expense_insurance' },
    { keywords: ['광고','마케팅','sns','블로그'],           type: 'out', category: 'expense_marketing' },
    { keywords: ['사무','문구','장비','컴퓨터','소모품'],   type: 'out', category: 'expense_office' },
    { keywords: ['통신','전화','인터넷','kt','skt','lg'],   type: 'out', category: 'expense_communication' },
    { keywords: ['세금','부가세','소득세','공과금'],        type: 'out', category: 'expense_tax' },
];

// 문자 메세지 파싱 함수
// 형식: [web발신]신한MM/DD HH:MM 계좌번호입금/출금 금액 적요
function parseShinhanSMS(msg) {
    try {
        // 줄바꿈 정규화
        const flat = msg.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

        // 계좌번호 추출
        // 원화: 140-013-623890 (xxx-xxx-xxxxxx)
        // 외화: 180*678887[USD] → 180-011-678887 로 매핑
        let account_number = null;
        const wonAccMatch = flat.match(/(\d{3}-\d{3}-\d{6})/);
        const usdAccMatch = flat.match(/(\d{3})\*(\d{6})\[(\w+)\]/);
        if (wonAccMatch) {
            account_number = wonAccMatch[1];
        } else if (usdAccMatch) {
            // 180*678887 → ACCOUNTS에서 끝 6자리로 매칭
            const suffix = usdAccMatch[2];
            account_number = Object.keys(ACCOUNTS).find(k => k.replace(/-/g, '').endsWith(suffix)) || `외화-${suffix}`;
        } else {
            return null;
        }

        // 입금/출금 구분
        const typeMatch = flat.match(/(입금|출금)/);
        if (!typeMatch) return null;
        const type = typeMatch[1] === '입금' ? 'in' : 'out';

        // 금액 추출 (소수점 포함, 콤마 포함)
        const amountMatch = flat.match(/(입금|출금)\s*([\d,]+\.?\d*)/);
        if (!amountMatch) return null;
        const amount = parseFloat(amountMatch[2].replace(/,/g, ''));

        // 날짜 추출 - 두 가지 형식 지원
        // 원화: 신한02/26 15:02  (공백 구분)
        // 외화: 신한02/26-14:25  (- 구분)
        const dateMatch = flat.match(/신한(\d{2})\/(\d{2})[-\s](\d{2}):(\d{2})/);
        let transaction_at = new Date();
        if (dateMatch) {
            const now = new Date();
            const month = parseInt(dateMatch[1], 10) - 1;
            const day   = parseInt(dateMatch[2], 10);
            const hour  = parseInt(dateMatch[3], 10);
            const min   = parseInt(dateMatch[4], 10);
            // SMS 시간은 KST(UTC+9) → UTC로 저장 (9시간 빼기)
            transaction_at = new Date(Date.UTC(now.getUTCFullYear(), month, day, hour - 9, min, 0));
        }

        // 적요: 금액 뒤 텍스트 (잔액 줄 제외)
        const memoMatch = flat.match(/(입금|출금)\s*[\d,.]+\s*(잔액.+?)?([A-Z].+|[가-힣].+)/);
        const memo = memoMatch ? memoMatch[3].trim() : '';

        // 자동 분류
        let category = 'uncategorized';
        const memoLower = memo.toLowerCase();
        for (const rule of AUTO_CATEGORY_RULES) {
            if (rule.type === type && rule.keywords.some(k => memoLower.includes(k.toLowerCase()))) {
                category = rule.category;
                break;
            }
        }

        const accountInfo = ACCOUNTS[account_number] || { alias: '알수없음', currency: usdAccMatch ? 'USD' : 'KRW' };

        return {
            account_number,
            account_alias: accountInfo.alias,
            currency: accountInfo.currency,
            type,
            amount,
            memo,
            transaction_at,
            category,
            raw_message: msg,
            source: 'webhook',
        };
    } catch (e) {
        return null;
    }
}

// 웹훅 수신 로그 (메모리 임시 저장, 최근 20건)
const webhookLog = [];

// ==================== 웹훅 수신 ====================
// 매크로드로이드에서 POST로 문자 전송
router.post('/webhook', async (req, res) => {
    const logEntry = { time: new Date().toISOString(), body: req.body, result: null };
    try {
        // body 전체에서 문자 찾기 (키 이름 무관, plain text도 처리)
        let raw = '';
        if (typeof req.body === 'string') {
            raw = req.body;
        } else if (req.body && typeof req.body === 'object') {
            raw = req.body.message || req.body.msg || req.body.sms || req.body.text || req.body.body || req.body.content || req.body.data || '';
            if (!raw) raw = JSON.stringify(req.body);
        }
        // 한글 인코딩 깨짐 복구 (ISO-8859-1로 잘못 파싱된 경우 UTF-8로 재디코딩)
        if (raw && raw.includes('?')) {
            try {
                const reencoded = Buffer.from(raw, 'latin1').toString('utf8');
                if (!reencoded.includes('?') || reencoded.length === raw.length) raw = reencoded;
            } catch (e) { /* 무시 */ }
        }
        // raw string에서 JSON 파싱 시도
        if (raw && raw.startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                raw = parsed.message || parsed.msg || parsed.sms || parsed.text || raw;
            } catch (e) { /* JSON 아님, 그대로 사용 */ }
        }

        logEntry.raw = raw;
        webhookLog.unshift(logEntry);
        if (webhookLog.length > 20) webhookLog.pop();

        if (!raw) {
            logEntry.result = 'empty body';
            return res.status(400).json({ success: false, message: '메세지 없음' });
        }

        // 신한 문자가 아니면 무시
        if (!raw.includes('신한') && !raw.includes('Shinhan')) {
            logEntry.result = '신한 아님 - 무시';
            return res.json({ success: true, message: '신한 문자 아님, 무시' });
        }

        // 파싱 시도 후 성공하면 저장, 실패해도 raw_message만으로 저장
        const parsed = parseShinhanSMS(raw) || {};
        const tx = await BankTransaction.create({
            account_number: parsed.account_number || '미파싱',
            account_alias: parsed.account_alias || '미파싱',
            currency: parsed.currency || 'KRW',
            type: parsed.type || 'unknown',
            amount: parsed.amount || 0,
            memo: parsed.memo || '',
            transaction_at: parsed.transaction_at || new Date(),
            category: parsed.category || 'uncategorized',
            raw_message: raw,
            source: 'webhook',
        });
        logEntry.result = parsed.account_number ? '저장 완료' : '파싱 실패 - raw만 저장';
        logEntry.tx_id = tx._id;
        console.log('[BANK WEBHOOK] 저장:', tx._id, raw.substring(0, 50));
        res.json({ success: true, message: logEntry.result, data: tx });
    } catch (e) {
        logEntry.result = '오류: ' + e.message;
        webhookLog.unshift(logEntry);
        if (webhookLog.length > 20) webhookLog.pop();
        console.error('[BANK WEBHOOK] 오류:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 카드승인 파싱 함수 ====================
// 형식: 신한법인해외승인 9073 02/27 10:53 2,640.00 달러 (GU)DUSIT THANI
function parseShinhanCard(msg) {
    try {
        const flat = msg.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
        if (!flat.includes('신한법인해외승인')) return null;

        // 카드번호 끝 4자리
        const cardMatch = flat.match(/신한법인해외승인\s+(\d{4})/);
        const card_number = cardMatch ? cardMatch[1] : '****';

        // 날짜: MM/DD HH:MM
        const dateMatch = flat.match(/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
        let transaction_at = new Date();
        if (dateMatch) {
            const now = new Date();
            const month = parseInt(dateMatch[1], 10) - 1;
            const day   = parseInt(dateMatch[2], 10);
            const hour  = parseInt(dateMatch[3], 10);
            const min   = parseInt(dateMatch[4], 10);
            transaction_at = new Date(Date.UTC(now.getUTCFullYear(), month, day, hour - 9, min, 0));
        }

        // 금액: 숫자,숫자.숫자
        const amountMatch = flat.match(/([\d,]+\.?\d*)\s*달러/);
        if (!amountMatch) return null;
        const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

        // 가맹점명: 달러 이후 텍스트
        const memoMatch = flat.match(/달러\s+(.+)$/);
        const memo = memoMatch ? memoMatch[1].trim() : '';

        return { card_number, transaction_at, amount, memo, currency: 'USD' };
    } catch (e) {
        return null;
    }
}

// ==================== 카드승인 웹훅 ====================
router.post('/card-webhook', async (req, res) => {
    let raw = '';
    try {
        if (typeof req.body === 'string') {
            raw = req.body;
        } else if (req.body && typeof req.body === 'object') {
            raw = req.body.message || req.body.msg || req.body.sms || req.body.text || JSON.stringify(req.body);
        }
        raw = raw.trim();

        if (!raw.includes('신한법인해외승인')) {
            return res.json({ success: true, message: '카드승인 문자 아님, 무시' });
        }

        const parsed = parseShinhanCard(raw);
        if (!parsed) {
            return res.status(400).json({ success: false, message: '파싱 실패', raw });
        }

        const tx = await BankTransaction.create({
            account_number: 'CARD-' + parsed.card_number,
            account_alias: '신한해외카드(' + parsed.card_number + ')',
            currency: 'USD',
            type: 'out',
            amount: parsed.amount,
            memo: parsed.memo,
            transaction_at: parsed.transaction_at,
            category: 'uncategorized',
            raw_message: raw,
            source: 'card',
        });
        console.log('[CARD WEBHOOK] 저장:', tx._id, raw.substring(0, 60));
        res.json({ success: true, message: '카드승인 저장 완료', data: tx });
    } catch (e) {
        console.error('[CARD WEBHOOK] 오류:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 카드 내역 조회 ====================
router.get('/card-transactions', async (req, res) => {
    try {
        const { start, end, page = 1, limit = 50 } = req.query;
        const filter = { source: 'card' };
        if (start || end) {
            filter.transaction_at = {};
            if (start) filter.transaction_at.$gte = new Date(start);
            if (end)   filter.transaction_at.$lte = new Date(end + 'T23:59:59');
        }
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [data, total] = await Promise.all([
            BankTransaction.find(filter).sort({ transaction_at: -1 }).skip(skip).limit(parseInt(limit)),
            BankTransaction.countDocuments(filter),
        ]);
        res.json({ success: true, data, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 카드 승인가능한도 조회 ====================
// 가능한도 = 기존한도(400) + 신한외환계좌 입금합계 - 카드승인 출금합계
router.get('/card-limit', async (req, res) => {
    try {
        const BASE_LIMIT = 400; // USD 기존 고정 한도

        // 신한외환 계좌 입금 합계
        const inAgg = await BankTransaction.aggregate([
            { $match: { account_number: '180-011-678887', type: 'in', currency: 'USD' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const TOTAL_IN_OFFSET = 153246; // 과거 데이터 일괄 등록으로 인한 보정값 차감
        const totalInRaw = inAgg.length ? inAgg[0].total : 0;
        const totalIn = Math.max(0, totalInRaw - TOTAL_IN_OFFSET);

        // 카드승인 출금 합계
        const cardAgg = await BankTransaction.aggregate([
            { $match: { source: 'card', type: 'out', currency: 'USD' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalCard = cardAgg.length ? cardAgg[0].total : 0;

        const available = BASE_LIMIT + totalIn - totalCard;
        res.json({
            success: true,
            base_limit: BASE_LIMIT,
            total_in: totalIn,
            total_card_used: totalCard,
            available,
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 웹훅 진단 (브라우저에서 확인) ====================
router.get('/webhook-log', (req, res) => {
    res.json({ success: true, count: webhookLog.length, logs: webhookLog });
});

// ==================== 파싱 테스트 ====================
router.get('/webhook-test', (req, res) => {
    const msg = req.query.msg || '[web발신]신한02/25 17:18 140-013-623890출금 2,957,683 2월급여정광재';
    const result = parseShinhanSMS(msg);
    res.json({ success: true, input: msg, parsed: result });
});

router.get('/card-test', (req, res) => {
    const msg = req.query.msg || '신한법인해외승인 9073 02/27 10:53 5.00 달러 (GU)DUSIT THANI';
    const result = parseShinhanCard(msg);
    res.json({ success: true, input: msg, parsed: result });
});

// ==================== 거래 내역 조회 ====================
router.get('/transactions', async (req, res) => {
    try {
        const { account, type, category, start, end, memo, page = 1, limit = 50 } = req.query;
        const filter = { source: { $ne: 'card' } };
        if (account && account !== 'all') filter.account_number = account;
        if (type && type !== 'all') filter.type = type;
        if (category && category !== 'all') filter.category = category;
        if (start || end) {
            filter.transaction_at = {};
            if (start) filter.transaction_at.$gte = new Date(start);
            if (end)   filter.transaction_at.$lte = new Date(end + 'T23:59:59');
        }
        if (memo) filter.memo = { $regex: memo, $options: 'i' };
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [data, total] = await Promise.all([
            BankTransaction.find(filter).sort({ transaction_at: -1 }).skip(skip).limit(parseInt(limit)),
            BankTransaction.countDocuments(filter),
        ]);
        res.json({ success: true, data, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 단건 조회 ====================
router.get('/transactions/:id', async (req, res) => {
    try {
        const tx = await BankTransaction.findById(req.params.id);
        if (!tx) return res.status(404).json({ success: false, message: '없음' });
        res.json({ success: true, data: tx });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 수동 등록 ====================
router.post('/transactions', async (req, res) => {
    try {
        const { account_number, type, amount, memo, transaction_at, category, notes, currency } = req.body;
        if (!account_number || !type || !amount || !transaction_at) {
            return res.status(400).json({ success: false, message: '계좌번호, 구분, 금액, 일시는 필수입니다.' });
        }
        const accountInfo = ACCOUNTS[account_number] || { alias: account_number, currency: currency || 'KRW' };
        const tx = await BankTransaction.create({
            account_number, account_alias: accountInfo.alias,
            currency: currency || accountInfo.currency,
            type, amount, memo: memo || '',
            transaction_at: new Date(transaction_at),
            category: category || 'uncategorized',
            notes: notes || '',
            source: 'manual',
            raw_message: '',
        });
        res.json({ success: true, data: tx });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 분류 수정 ====================
router.put('/transactions/:id', async (req, res) => {
    try {
        const { category, notes, is_confirmed, linked_erp_type, linked_erp_id } = req.body;
        const update = {};
        if (category !== undefined)        update.category = category;
        if (notes !== undefined)           update.notes = notes;
        if (is_confirmed !== undefined)    update.is_confirmed = is_confirmed;
        if (linked_erp_type !== undefined) update.linked_erp_type = linked_erp_type;
        if (linked_erp_id !== undefined)   update.linked_erp_id = linked_erp_id;
        const tx = await BankTransaction.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!tx) return res.status(404).json({ success: false, message: '없음' });
        res.json({ success: true, data: tx });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 삭제 ====================
router.delete('/transactions/:id', async (req, res) => {
    try {
        const tx = await BankTransaction.findByIdAndDelete(req.params.id);
        if (!tx) return res.status(404).json({ success: false, message: '없음' });
        res.json({ success: true, message: '삭제 완료' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 계좌별 요약 통계 ====================
router.get('/summary', async (req, res) => {
    try {
        const { start, end } = req.query;
        const filter = {};
        if (start || end) {
            filter.transaction_at = {};
            if (start) filter.transaction_at.$gte = new Date(start);
            if (end)   filter.transaction_at.$lte = new Date(end + 'T23:59:59');
        }
        const agg = await BankTransaction.aggregate([
            { $match: filter },
            { $group: {
                _id: { account: '$account_number', type: '$type' },
                total: { $sum: '$amount' },
                count: { $sum: 1 },
            }},
        ]);
        // 카테고리별 합계
        const catAgg = await BankTransaction.aggregate([
            { $match: filter },
            { $group: {
                _id: { category: '$category', type: '$type' },
                total: { $sum: '$amount' },
                count: { $sum: 1 },
            }},
        ]);
        res.json({ success: true, by_account: agg, by_category: catAgg });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 계좌 목록 ====================
router.get('/accounts', (req, res) => {
    const list = Object.entries(ACCOUNTS).map(([number, info]) => ({
        account_number: number, ...info
    }));
    res.json({ success: true, data: list });
});

// ==================== 카테고리 초기 데이터 시드 ====================
const DEFAULT_CATEGORIES = [
    // 입금
    { code:'deposit_trust',         label:'행사비 (수탁액)',   type:'in',  vat_taxable:true,  vat_deductible:false, keywords:['계약금','예약금','입금확인','입금완료'], sort_order:1 },
    { code:'deposit_receivable',    label:'미수금 회수',       type:'in',  vat_taxable:true,  vat_deductible:false, keywords:['미수','잔금수령'], sort_order:2 },
    { code:'deposit_refund',        label:'환불 입금',         type:'in',  vat_taxable:false, vat_deductible:false, keywords:['환불','반환'], sort_order:3 },
    { code:'deposit_insurance',     label:'보험금 수령',       type:'in',  vat_taxable:false, vat_deductible:false, keywords:['보험금','보상금'], sort_order:4 },
    { code:'deposit_advance_refund',label:'가지급금 상환',     type:'in',  vat_taxable:false, vat_deductible:false, keywords:[], sort_order:5 },
    { code:'deposit_tax_refund',    label:'세금 환급',         type:'in',  vat_taxable:false, vat_deductible:false, keywords:[], sort_order:6 },
    { code:'deposit_other',         label:'기타 입금',         type:'in',  vat_taxable:false, vat_deductible:false, keywords:[], sort_order:7 },
    // 출금
    { code:'expense_salary',        label:'급여',              type:'out', vat_deductible:false, vat_taxable:false, keywords:['급여','salary','페이'], sort_order:10 },
    { code:'expense_ground',        label:'지상비',            type:'out', vat_deductible:true,  vat_taxable:false, keywords:['지상비','랜드','행사비'], sort_order:11 },
    { code:'expense_airfare',       label:'항공료',            type:'out', vat_deductible:false, vat_taxable:false, keywords:['항공','airfare','대한항공','아시아나','제주항공'], sort_order:12 },
    { code:'expense_hotel',         label:'숙박비',            type:'out', vat_deductible:true,  vat_taxable:false, keywords:['호텔','hotel','숙박','리조트'], sort_order:13 },
    { code:'expense_transport',     label:'차량/교통비',       type:'out', vat_deductible:true,  vat_taxable:false, keywords:['교통','차량','택시','버스'], sort_order:14 },
    { code:'expense_meal',          label:'식대',              type:'out', vat_deductible:true,  vat_taxable:false, keywords:['식대','점심','저녁','밥','커피','카페'], sort_order:15 },
    { code:'expense_entertainment', label:'접대비',            type:'out', vat_deductible:false, vat_taxable:false, keywords:['접대','골프','선물'], sort_order:16 },
    { code:'expense_insurance',     label:'여행자보험',        type:'out', vat_deductible:false, vat_taxable:false, keywords:['보험','여행자보험'], sort_order:17 },
    { code:'expense_dev',           label:'개발수수료',        type:'out', vat_deductible:true,  vat_taxable:false, keywords:[], sort_order:18 },
    { code:'expense_marketing_fee', label:'마케팅대행료',      type:'out', vat_deductible:true,  vat_taxable:false, keywords:[], sort_order:19 },
    { code:'expense_marketing',     label:'광고/마케팅비',     type:'out', vat_deductible:true,  vat_taxable:false, keywords:['광고','마케팅','sns','블로그'], sort_order:20 },
    { code:'expense_advance',       label:'가지급금',          type:'out', vat_deductible:false, vat_taxable:false, keywords:[], sort_order:21 },
    { code:'expense_office',        label:'사무용품/장비',     type:'out', vat_deductible:true,  vat_taxable:false, keywords:['사무','문구','장비','컴퓨터','소모품'], sort_order:22 },
    { code:'expense_communication', label:'통신비',            type:'out', vat_deductible:true,  vat_taxable:false, keywords:['통신','전화','인터넷','kt','skt','lg'], sort_order:23 },
    { code:'expense_tax',           label:'세금/공과금',       type:'out', vat_deductible:false, vat_taxable:false, keywords:['세금','부가세','소득세','공과금'], sort_order:24 },
    { code:'expense_other',         label:'기타경비',          type:'out', vat_deductible:false, vat_taxable:false, keywords:[], sort_order:25 },
    { code:'uncategorized',         label:'미분류',            type:'both',vat_deductible:false, vat_taxable:false, keywords:[], sort_order:99 },
];

async function seedCategories() {
    try {
        const count = await BankCategory.countDocuments();
        if (count === 0) {
            await BankCategory.insertMany(DEFAULT_CATEGORIES);
            console.log('[BankCategory] 기본 카테고리 시드 완료:', DEFAULT_CATEGORIES.length, '개');
        }
    } catch (e) {
        console.error('[BankCategory] 시드 오류:', e.message);
    }
}
seedCategories();

// ==================== 카테고리 목록 (DB 기반) ====================
router.get('/categories', async (req, res) => {
    try {
        const cats = await BankCategory.find({ is_active: true }).sort({ type:1, sort_order:1 });
        const result = { in: [], out: [], both: [], all: [] };
        cats.forEach(c => {
            const item = { value: c.code, label: c.label, vat_deductible: c.vat_deductible, vat_taxable: c.vat_taxable, keywords: c.keywords, _id: c._id };
            result.all.push(item);
            if (c.type === 'in')   result.in.push(item);
            else if (c.type === 'out')  result.out.push(item);
            else { result.in.push(item); result.out.push(item); result.both.push(item); }
        });
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 카테고리 전체 목록 (관리용, 비활성 포함) ====================
router.get('/categories/all', async (req, res) => {
    try {
        const cats = await BankCategory.find().sort({ type:1, sort_order:1 });
        res.json({ success: true, data: cats });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 카테고리 추가 ====================
router.post('/categories', async (req, res) => {
    try {
        const { code, label, type, vat_deductible, vat_taxable, keywords, description, sort_order } = req.body;
        if (!code || !label || !type) return res.status(400).json({ success: false, message: 'code, label, type 필수' });
        const exists = await BankCategory.findOne({ code });
        if (exists) return res.status(400).json({ success: false, message: `코드 "${code}" 이미 존재합니다.` });
        const cat = await BankCategory.create({
            code: code.trim().toLowerCase().replace(/\s+/g, '_'),
            label: label.trim(),
            type,
            vat_deductible: !!vat_deductible,
            vat_taxable: !!vat_taxable,
            keywords: Array.isArray(keywords) ? keywords : (keywords || '').split(',').map(k => k.trim()).filter(Boolean),
            description: description || '',
            sort_order: sort_order || 0,
        });
        res.json({ success: true, data: cat });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 카테고리 수정 ====================
router.put('/categories/:id', async (req, res) => {
    try {
        const { label, type, vat_deductible, vat_taxable, keywords, description, sort_order, is_active } = req.body;
        const update = {};
        if (label !== undefined)          update.label = label.trim();
        if (type !== undefined)           update.type = type;
        if (vat_deductible !== undefined) update.vat_deductible = !!vat_deductible;
        if (vat_taxable !== undefined)    update.vat_taxable = !!vat_taxable;
        if (keywords !== undefined)       update.keywords = Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim()).filter(Boolean);
        if (description !== undefined)    update.description = description;
        if (sort_order !== undefined)     update.sort_order = sort_order;
        if (is_active !== undefined)      update.is_active = !!is_active;
        const cat = await BankCategory.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!cat) return res.status(404).json({ success: false, message: '없음' });
        res.json({ success: true, data: cat });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 카테고리 삭제 (소프트) ====================
router.delete('/categories/:id', async (req, res) => {
    try {
        const cat = await BankCategory.findById(req.params.id);
        if (!cat) return res.status(404).json({ success: false, message: '없음' });
        if (cat.code === 'uncategorized') return res.status(400).json({ success: false, message: '기본 미분류 항목은 삭제할 수 없습니다.' });
        await BankCategory.findByIdAndUpdate(req.params.id, { is_active: false });
        res.json({ success: true, message: '비활성화 완료' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 엑셀 파싱 유틸 ====================
function parseExcelDate(raw) {
    if (!raw && raw !== 0) return null;
    // 숫자만 추출
    const s = String(raw).replace(/[^0-9]/g, '');
    if (s.length >= 14) {
        // YYYYMMDDHHmmss
        const y = parseInt(s.slice(0,4)), mo = parseInt(s.slice(4,6))-1;
        const d = parseInt(s.slice(6,8)), h = parseInt(s.slice(8,10));
        const mi = parseInt(s.slice(10,12)), se = parseInt(s.slice(12,14));
        const dt = new Date(y, mo, d, h, mi, se);
        return isNaN(dt) ? null : dt;
    } else if (s.length === 8) {
        // YYYYMMDD
        const y = parseInt(s.slice(0,4)), mo = parseInt(s.slice(4,6))-1;
        const d = parseInt(s.slice(6,8));
        const dt = new Date(y, mo, d, 0, 0, 0);
        return isNaN(dt) ? null : dt;
    }
    // xlsx 숫자 날짜 (엑셀 시리얼 넘버)
    if (!isNaN(raw) && Number(raw) > 40000 && Number(raw) < 60000) {
        const d = XLSX.SSF.parse_date_code(Number(raw));
        if (d) return new Date(d.y, d.m-1, d.d, d.H||0, d.M||0, d.S||0);
    }
    const dt = new Date(raw);
    return isNaN(dt) ? null : dt;
}

function parseExcelAmount(raw) {
    if (!raw && raw !== 0) return 0;
    const n = parseFloat(String(raw).replace(/,/g, ''));
    return isNaN(n) ? 0 : Math.abs(n);
}

async function autoClassifyFromDB(memo, type) {
    try {
        const lower = (memo || '').toLowerCase();
        const cats = await BankCategory.find({ is_active: true, type: { $in: [type, 'both'] } }).sort({ sort_order: 1 });
        for (const cat of cats) {
            if (cat.keywords && cat.keywords.some(k => k && lower.includes(k.toLowerCase()))) {
                return cat.code;
            }
        }
    } catch (e) {
        // DB 오류 시 하드코딩 룰 폴백
        const lower = (memo || '').toLowerCase();
        for (const rule of AUTO_CATEGORY_RULES) {
            if (rule.type === type && rule.keywords.some(k => lower.includes(k.toLowerCase()))) {
                return rule.category;
            }
        }
    }
    return 'uncategorized';
}

async function parseExcelRows(buffer, accountNumber) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // 헤더 행 자동 감지 (거래일시/날짜/일자 포함 행)
    let headerIdx = -1;
    let colMap = { date:-1, in:-1, out:-1, memo:-1, balance:-1 };

    for (let i = 0; i < Math.min(15, allRows.length); i++) {
        const row = allRows[i].map(c => String(c).trim().replace(/\s/g,''));
        const joined = row.join('|');
        if (/거래일|날짜|일시|일자|date/i.test(joined)) {
            headerIdx = i;
            row.forEach((cell, idx) => {
                const c = cell.toLowerCase();
                if (/거래일|날짜|일시|일자|date/.test(c) && colMap.date === -1)   colMap.date = idx;
                else if (/입금/.test(c) && colMap.in === -1)                      colMap.in = idx;
                else if (/출금/.test(c) && colMap.out === -1)                     colMap.out = idx;
                else if (/내용|적요|메모|memo|비고/.test(c) && colMap.memo === -1) colMap.memo = idx;
                else if (/잔액/.test(c) && colMap.balance === -1)                 colMap.balance = idx;
            });
            break;
        }
    }

    // 헤더 못찾으면 첫 행 기준 위치 추정
    if (headerIdx === -1) headerIdx = 0;
    if (colMap.date    === -1) colMap.date    = 0;
    if (colMap.in      === -1) colMap.in      = 1;
    if (colMap.out     === -1) colMap.out     = 2;
    if (colMap.memo    === -1) colMap.memo    = 3;
    if (colMap.balance === -1) colMap.balance = 4;

    const accountInfo = ACCOUNTS[accountNumber] || { alias: accountNumber, currency: 'KRW' };
    const results = [];
    const errors  = [];

    const dataRows = allRows.slice(headerIdx + 1);
    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const rawDate = row[colMap.date];
        const rawIn   = row[colMap.in];
        const rawOut  = row[colMap.out];
        const rawMemo = String(row[colMap.memo] || '').trim();

        // 빈 행 스킵
        if (!rawDate && !rawIn && !rawOut) continue;

        const transaction_at = parseExcelDate(rawDate);
        if (!transaction_at) {
            errors.push({ row: headerIdx + i + 2, reason: `날짜 파싱 실패: "${rawDate}"` });
            continue;
        }

        const inAmt  = parseExcelAmount(rawIn);
        const outAmt = parseExcelAmount(rawOut);

        let type, amount;
        if (inAmt > 0 && outAmt === 0)       { type = 'in';  amount = inAmt; }
        else if (outAmt > 0 && inAmt === 0)  { type = 'out'; amount = outAmt; }
        else if (inAmt > 0)                  { type = 'in';  amount = inAmt; }
        else if (outAmt > 0)                 { type = 'out'; amount = outAmt; }
        else {
            errors.push({ row: headerIdx + i + 2, reason: `금액 없음 (입금:${rawIn}, 출금:${rawOut})` });
            continue;
        }

        const category = await autoClassifyFromDB(rawMemo, type);

        results.push({
            account_number: accountNumber,
            account_alias:  accountInfo.alias,
            currency:       accountInfo.currency,
            type,
            amount,
            memo:           rawMemo,
            transaction_at,
            category,
            source:         'manual',
            raw_message:    '',
        });
    }

    return { rows: results, errors, colMap, headerIdx };
}

// ==================== 엑셀 미리보기 (업로드 → 파싱만, DB 저장 안 함) ====================
router.post('/excel-preview', upload.single('excel'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });
        const accountNumber = req.body.account_number;
        if (!accountNumber || !ACCOUNTS[accountNumber]) {
            return res.status(400).json({ success: false, message: '유효한 계좌번호를 선택하세요.' });
        }
        const { rows, errors } = parseExcelRows(req.file.buffer, accountNumber);
        res.json({ success: true, rows, errors, total: rows.length });
    } catch (e) {
        console.error('[EXCEL PREVIEW]', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 엑셀 일괄 등록 (미리보기 확인 후 실제 저장) ====================
router.post('/excel-import', express.json({ limit: '5mb' }), async (req, res) => {
    try {
        const { rows } = req.body;
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ success: false, message: '등록할 데이터가 없습니다.' });
        }
        let successCount = 0, errorCount = 0;
        const errorList = [];
        for (const row of rows) {
            try {
                await BankTransaction.create({
                    account_number: row.account_number,
                    account_alias:  row.account_alias,
                    currency:       row.currency,
                    type:           row.type,
                    amount:         row.amount,
                    memo:           row.memo || '',
                    transaction_at: new Date(row.transaction_at),
                    category:       row.category || 'uncategorized',
                    source:         'manual',
                    raw_message:    '',
                });
                successCount++;
            } catch (e) {
                errorCount++;
                errorList.push(e.message);
            }
        }
        res.json({ success: true, successCount, errorCount, errorList });
    } catch (e) {
        console.error('[EXCEL IMPORT]', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ==================== 자동 분류 일괄 적용 ====================
// is_confirmed=false 이면서 category='uncategorized' 인 거래에 DB 키워드 룰 적용
// force=true 이면 uncategorized 포함 미확정(is_confirmed=false) 전체 재분류
router.post('/auto-classify', async (req, res) => {
    try {
        const { force = false } = req.body;

        // 분류 대상 쿼리: is_confirmed=false 거래 (확정 거래는 보존)
        const filter = { is_confirmed: false, source: { $ne: 'card' } };
        if (!force) filter.category = 'uncategorized'; // 기본: 미분류만

        const txList = await BankTransaction.find(filter);
        if (!txList.length) {
            return res.json({ success: true, updated: 0, message: '분류 대상 거래가 없습니다.' });
        }

        // 활성 카테고리 키워드 전체 로드 (DB 1회 조회)
        const cats = await BankCategory.find({ is_active: true }).sort({ sort_order: 1 });

        let updated = 0;
        const bulkOps = [];

        for (const tx of txList) {
            const lower = (tx.memo || '').toLowerCase();
            let matched = 'uncategorized';

            for (const cat of cats) {
                if (!cat.keywords || !cat.keywords.length) continue;
                const typeMatch = cat.type === 'both' || cat.type === tx.type;
                if (!typeMatch) continue;
                if (cat.keywords.some(k => k && lower.includes(k.toLowerCase()))) {
                    matched = cat.code;
                    break;
                }
            }

            // 변경 있을 때만 업데이트
            if (matched !== tx.category) {
                bulkOps.push({
                    updateOne: {
                        filter: { _id: tx._id },
                        update: { $set: { category: matched } },
                    },
                });
                updated++;
            }
        }

        if (bulkOps.length) {
            await BankTransaction.bulkWrite(bulkOps);
        }

        console.log(`[AUTO-CLASSIFY] 대상:${txList.length}건 / 변경:${updated}건`);
        res.json({ success: true, total: txList.length, updated, message: `${updated}건 분류 적용 완료` });
    } catch (e) {
        console.error('[AUTO-CLASSIFY]', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 기존 데이터 시간 보정 (KST→UTC, -9시간) - 한 번만 실행
router.post('/fix-timezone', async (req, res) => {
    try {
        const docs = await BankTransaction.find({});
        let count = 0;
        for (const doc of docs) {
            const fixed = new Date(doc.transaction_at.getTime() - 9 * 60 * 60 * 1000);
            await BankTransaction.updateOne({ _id: doc._id }, { transaction_at: fixed });
            count++;
        }
        res.json({ success: true, message: `${count}건 시간 보정 완료 (-9시간)` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
