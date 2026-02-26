const express = require('express');
const router = express.Router();
const BankTransaction = require('../models/BankTransaction');

// text/plain body 파싱 지원
router.use(express.text({ type: 'text/plain' }));

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
    { keywords: ['선급','선지급'],                         type: 'out', category: 'expense_prepaid' },
    { keywords: ['미지급'],                                type: 'out', category: 'expense_unpaid' },
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
            transaction_at = new Date(now.getFullYear(), month, day, hour, min, 0);
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

// ==================== 거래 내역 조회 ====================
router.get('/transactions', async (req, res) => {
    try {
        const { account, type, category, start, end, page = 1, limit = 50 } = req.query;
        const filter = {};
        if (account && account !== 'all') filter.account_number = account;
        if (type && type !== 'all') filter.type = type;
        if (category && category !== 'all') filter.category = category;
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

// ==================== 카테고리 목록 ====================
router.get('/categories', (req, res) => {
    const categories = {
        in: [
            { value: 'deposit_trust',      label: '수탁액 (계약금/잔금)' },
            { value: 'deposit_receivable', label: '미수금 회수' },
            { value: 'deposit_refund',     label: '환불 입금' },
            { value: 'deposit_insurance',  label: '보험금 수령' },
            { value: 'deposit_other',      label: '기타 입금' },
        ],
        out: [
            { value: 'expense_salary',        label: '급여' },
            { value: 'expense_ground',        label: '지상비' },
            { value: 'expense_prepaid',       label: '선급금 (출발 전 지상비)' },
            { value: 'expense_unpaid',        label: '미지급금 (출발 후 지상비)' },
            { value: 'expense_airfare',       label: '항공료' },
            { value: 'expense_hotel',         label: '숙박비' },
            { value: 'expense_transport',     label: '차량/교통비' },
            { value: 'expense_meal',          label: '식대' },
            { value: 'expense_entertainment', label: '접대비' },
            { value: 'expense_insurance',     label: '여행자보험' },
            { value: 'expense_marketing',     label: '광고/마케팅비' },
            { value: 'expense_office',        label: '사무용품/장비' },
            { value: 'expense_communication', label: '통신비' },
            { value: 'expense_tax',           label: '세금/공과금' },
            { value: 'expense_other',         label: '기타경비' },
        ],
        common: [
            { value: 'uncategorized', label: '미분류' },
        ],
    };
    res.json({ success: true, data: categories });
});

module.exports = router;
