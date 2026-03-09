// ==================== 전역 상태 ====================
const CATEGORY_LABELS = {};
let allCategories = { in: [], out: [], common: [] };
let allAccounts   = [];
let currentAccount = 'all';
let currentPage    = 1;
const PAGE_LIMIT   = 50;

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', async () => {
    setDefaultDates();
    await Promise.all([loadAccounts(), loadCategories()]);
    loadTransactions();
    loadSummary();

    document.getElementById('btnSearch').addEventListener('click', () => { currentPage = 1; loadTransactions(); loadSummary(); });
    document.getElementById('btnReset').addEventListener('click', resetFilters);
    document.getElementById('btnAddManual').addEventListener('click', openManualModal);
    document.getElementById('btnSaveManual').addEventListener('click', saveManual);
    document.getElementById('btnSaveCat').addEventListener('click', saveCat);
    document.getElementById('btnWebhookInfo').addEventListener('click', openWebhookModal);
    document.getElementById('btnCopyWebhook').addEventListener('click', copyWebhook);
    document.getElementById('mType').addEventListener('change', updateManualCats);
});

function setDefaultDates() {
    const n = new Date();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, '0');
    const last = new Date(y, n.getMonth() + 1, 0).getDate();
    document.getElementById('filterStart').value = `${y}-${m}-01`;
    document.getElementById('filterEnd').value   = `${y}-${m}-${String(last).padStart(2, '0')}`;
    const dt = new Date();
    dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
    document.getElementById('mDate').value = dt.toISOString().slice(0, 16);
}

function resetFilters() {
    setDefaultDates();
    document.getElementById('filterType').value     = 'all';
    document.getElementById('filterCategory').value = 'all';
    currentAccount = 'all';
    currentPage    = 1;
    document.querySelectorAll('.account-tab').forEach(t => t.classList.toggle('active', t.dataset.account === 'all'));
    loadTransactions();
    loadSummary();
}

function fmt(n) { return Math.round(n || 0).toLocaleString('ko-KR'); }

function showAlert(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    el.style.cssText = 'top:80px;right:20px;z-index:9999;min-width:260px;font-size:.85rem';
    el.innerHTML = msg + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

// ==================== 계좌 로드 ====================
async function loadAccounts() {
    try {
        const res  = await fetch('/api/bank/accounts');
        const data = await res.json();
        if (!data.success) return;
        allAccounts = data.data;
        const wrap = document.getElementById('accountTabs');
        allAccounts.forEach(acc => {
            const el = document.createElement('div');
            el.className = 'account-tab';
            el.dataset.account = acc.account_number;
            el.innerHTML = `<div class="acc-name">${acc.alias} <span class="badge bg-secondary" style="font-size:.6rem">${acc.currency}</span></div><div class="acc-num">${acc.account_number}</div>`;
            wrap.appendChild(el);
        });
        wrap.querySelectorAll('.account-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                currentAccount = tab.dataset.account;
                currentPage    = 1;
                wrap.querySelectorAll('.account-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                loadTransactions();
                loadSummary();
            });
        });
        const sel = document.getElementById('mAccount');
        sel.innerHTML = allAccounts.map(a => `<option value="${a.account_number}">${a.alias} (${a.account_number})</option>`).join('');
    } catch (e) { console.error('loadAccounts:', e); }
}

// ==================== 카테고리 로드 ====================
async function loadCategories() {
    try {
        const res  = await fetch('/api/bank/categories');
        const data = await res.json();
        if (!data.success) return;
        allCategories = data.data;
        (allCategories.all || []).forEach(c => {
            CATEGORY_LABELS[c.value] = c.label;
        });
        const fSel = document.getElementById('filterCategory');
        fSel.innerHTML  = '<option value="all">전체</option>';
        fSel.innerHTML += '<optgroup label="─ 입금">'  + (allCategories.in  || []).map(c => `<option value="${c.value}">${c.label}</option>`).join('') + '</optgroup>';
        fSel.innerHTML += '<optgroup label="─ 출금">'  + (allCategories.out || []).map(c => `<option value="${c.value}">${c.label}</option>`).join('') + '</optgroup>';
        fSel.innerHTML += (allCategories.both || []).map(c => `<option value="${c.value}">${c.label}</option>`).join('');
        updateManualCats();
    } catch (e) { console.error('loadCategories:', e); }
}

function updateManualCats() {
    const type = document.getElementById('mType').value;
    const cats = type === 'in'
        ? [...(allCategories.in || []),  ...(allCategories.both || [])]
        : [...(allCategories.out || []), ...(allCategories.both || [])];
    document.getElementById('mCategory').innerHTML = cats.map(c => `<option value="${c.value}">${c.label}</option>`).join('');
}

// ==================== 거래 내역 조회 ====================
function buildQuery() {
    const p = new URLSearchParams({ page: currentPage, limit: PAGE_LIMIT });
    const start = document.getElementById('filterStart').value;
    const end   = document.getElementById('filterEnd').value;
    const type  = document.getElementById('filterType').value;
    const cat   = document.getElementById('filterCategory').value;
    if (currentAccount !== 'all') p.set('account', currentAccount);
    if (type !== 'all')           p.set('type', type);
    if (cat  !== 'all')           p.set('category', cat);
    if (start)                    p.set('start', start);
    if (end)                      p.set('end', end);
    return p.toString();
}

async function loadTransactions() {
    try {
        const res  = await fetch('/api/bank/transactions?' + buildQuery());
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        renderTable(data.data);
        renderPagination(data.total, data.page, data.limit);
        document.getElementById('txCount').textContent = `총 ${data.total.toLocaleString()}건`;
    } catch (e) {
        document.getElementById('txTableBody').innerHTML = `<tr><td colspan="8" class="text-center py-4 text-danger">로드 실패: ${e.message}</td></tr>`;
    }
}

function renderTable(list) {
    const tbody = document.getElementById('txTableBody');
    if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-5 text-muted">거래 내역 없음</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(tx => {
        const isIn  = tx.type === 'in';
        const dt    = new Date(new Date(tx.transaction_at).getTime() + 9 * 60 * 60 * 1000);
        const ds    = `${dt.getUTCMonth()+1}/${dt.getUTCDate()} ${String(dt.getUTCHours()).padStart(2,'0')}:${String(dt.getUTCMinutes()).padStart(2,'0')}`;
        const label = CATEGORY_LABELS[tx.category] || tx.category;
        const uncat = tx.category === 'uncategorized';
        const conf  = tx.is_confirmed;
        const curr  = tx.currency === 'KRW' ? '원' : ' ' + tx.currency;
        return `<tr class="${isIn ? 'tx-row-in' : 'tx-row-out'}">
            <td style="white-space:nowrap;font-size:.78rem">${ds}</td>
            <td class="hide-sm"><small>${tx.account_alias || tx.account_number}</small></td>
            <td><span class="${isIn ? 'badge-in' : 'badge-out'}">${isIn ? '입금' : '출금'}</span></td>
            <td class="text-end fw-bold ${isIn ? 'c-green' : 'c-red'}">${fmt(tx.amount)}${curr}</td>
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${tx.memo || ''}">${tx.memo || '-'}</td>
            <td>
                <span class="cat-badge ${uncat ? 'uncat' : conf ? 'confirmed' : ''}">${label}</span>
                ${conf ? '<i class="fas fa-check-circle c-green ms-1" style="font-size:.7rem"></i>' : ''}
            </td>
            <td class="hide-sm" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem;color:#555" title="${tx.notes || ''}">${tx.notes || ''}</td>
            <td style="white-space:nowrap">
                <button class="btn btn-outline-primary btn-sm py-0 px-2" style="font-size:.72rem" data-id="${tx._id}" data-action="cat">분류</button>
                <button class="btn btn-outline-danger  btn-sm py-0 px-2 ms-1" style="font-size:.72rem" data-id="${tx._id}" data-action="del">삭제</button>
            </td>
        </tr>`;
    }).join('');
    tbody.querySelectorAll('[data-action="cat"]').forEach(btn => btn.addEventListener('click', () => openCatModal(btn.dataset.id)));
    tbody.querySelectorAll('[data-action="del"]').forEach(btn => btn.addEventListener('click', () => deleteTx(btn.dataset.id)));
}

function renderPagination(total, page, limit) {
    const area  = document.getElementById('paginationArea');
    const info  = document.getElementById('paginationInfo');
    const btns  = document.getElementById('paginationBtns');
    const pages = Math.ceil(total / limit);
    if (pages <= 1) { area.classList.add('d-none'); return; }
    area.classList.remove('d-none');
    info.textContent = `${page} / ${pages} 페이지`;
    btns.innerHTML = '';
    const mk = (label, p, dis) => {
        const b = document.createElement('button');
        b.className = 'btn btn-sm ' + (p === page ? 'btn-primary' : 'btn-outline-secondary');
        b.textContent = label;
        b.disabled    = dis;
        b.style.padding = '2px 10px';
        b.addEventListener('click', () => { currentPage = p; loadTransactions(); });
        return b;
    };
    btns.appendChild(mk('이전', page - 1, page <= 1));
    for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) {
        btns.appendChild(mk(i, i, false));
    }
    btns.appendChild(mk('다음', page + 1, page >= pages));
}

// ==================== 요약 통계 ====================
async function loadSummary() {
    try {
        const start = document.getElementById('filterStart').value;
        const end   = document.getElementById('filterEnd').value;
        const p     = new URLSearchParams();
        if (start)                    p.set('start', start);
        if (end)                      p.set('end', end);
        if (currentAccount !== 'all') p.set('account', currentAccount);
        const res  = await fetch('/api/bank/summary?' + p.toString());
        const data = await res.json();
        if (!data.success) return;

        let totalIn = 0, totalOut = 0;
        data.by_account.forEach(row => {
            if (row._id.type === 'in')  totalIn  += row.total;
            if (row._id.type === 'out') totalOut += row.total;
        });
        document.getElementById('statTotalIn').textContent  = fmt(totalIn)  + '원';
        document.getElementById('statTotalOut').textContent = fmt(totalOut) + '원';
        const net   = totalIn - totalOut;
        const netEl = document.getElementById('statNet');
        netEl.textContent = (net >= 0 ? '' : '-') + fmt(Math.abs(net)) + '원';
        netEl.className   = 'stat-value ' + (net >= 0 ? 'c-green' : 'c-red');

        // 미분류 건수 조회
        const r2  = await fetch('/api/bank/transactions?category=uncategorized&limit=1' + (currentAccount !== 'all' ? '&account=' + currentAccount : ''));
        const d2  = await r2.json();
        document.getElementById('statUncat').textContent = d2.success ? d2.total + '건' : '-';

        renderCatTables(data.by_category);
    } catch (e) { console.error('loadSummary:', e); }
}

function renderCatTables(rows) {
    const inRows  = (rows || []).filter(r => {
        const cat = r._id.category || '';
        return cat.startsWith('deposit_');
    });
    const outRows = (rows || []).filter(r => {
        const cat = r._id.category || '';
        return cat.startsWith('expense_') || cat === 'uncategorized';
    });

    const toHtml = (arr, cls) => arr.length
        ? arr.map(r => `<tr>
            <td>${CATEGORY_LABELS[r._id.category] || r._id.category}</td>
            <td class="text-end">${r.count}건</td>
            <td class="text-end ${cls} fw-bold">${fmt(r.total)}원</td>
        </tr>`).join('')
        : '<tr><td colspan="3" class="text-center text-muted py-3">내역 없음</td></tr>';

    document.getElementById('inCatTable').innerHTML  = toHtml(inRows,  'c-green');
    document.getElementById('outCatTable').innerHTML = toHtml(outRows, 'c-red');
}

// ==================== 분류 수정 모달 ====================
async function openCatModal(txId) {
    try {
        const res  = await fetch(`/api/bank/transactions/${txId}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        const tx = data.data;
        document.getElementById('catTxId').value = txId;
        const dt   = new Date(tx.transaction_at);
        const isIn = tx.type === 'in';
        document.getElementById('catTxInfo').innerHTML =
            `<strong>${isIn ? '입금' : '출금'}</strong> ${fmt(tx.amount)}원 &nbsp;|&nbsp; ${dt.toLocaleString('ko-KR')} &nbsp;|&nbsp; ${tx.memo || '-'}`;

        const cats = isIn
            ? [...(allCategories.in || []),  ...(allCategories.both || [])]
            : [...(allCategories.out || []), ...(allCategories.both || [])];
        document.getElementById('catSelect').innerHTML = cats.map(c =>
            `<option value="${c.value}" ${c.value === tx.category ? 'selected' : ''}>${c.label}</option>`
        ).join('');
        document.getElementById('catNotes').value     = tx.notes || '';
        document.getElementById('catConfirmed').checked = tx.is_confirmed || false;

        new bootstrap.Modal(document.getElementById('catModal')).show();
    } catch (e) { showAlert('거래 정보 로드 실패: ' + e.message, 'danger'); }
}

async function saveCat() {
    const txId    = document.getElementById('catTxId').value;
    const payload = {
        category:     document.getElementById('catSelect').value,
        notes:        document.getElementById('catNotes').value,
        is_confirmed: document.getElementById('catConfirmed').checked
    };
    try {
        const res  = await fetch(`/api/bank/transactions/${txId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        bootstrap.Modal.getInstance(document.getElementById('catModal')).hide();
        showAlert('분류 저장 완료');
        loadTransactions();
        loadSummary();
    } catch (e) { showAlert('저장 실패: ' + e.message, 'danger'); }
}

// ==================== 거래 삭제 ====================
async function deleteTx(txId) {
    if (!confirm('이 거래 내역을 삭제하시겠습니까?')) return;
    try {
        const res  = await fetch(`/api/bank/transactions/${txId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        showAlert('삭제되었습니다');
        loadTransactions();
        loadSummary();
    } catch (e) { showAlert('삭제 실패: ' + e.message, 'danger'); }
}

// ==================== 수동 등록 모달 ====================
function openManualModal() {
    updateManualCats();
    const dt = new Date();
    dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
    document.getElementById('mDate').value   = dt.toISOString().slice(0, 16);
    document.getElementById('mAmount').value = '';
    document.getElementById('mMemo').value   = '';
    document.getElementById('mNotes').value  = '';
    new bootstrap.Modal(document.getElementById('manualModal')).show();
}

async function saveManual() {
    const amount = parseFloat(document.getElementById('mAmount').value);
    if (!amount || amount <= 0) { showAlert('금액을 입력하세요', 'warning'); return; }
    const dateVal = document.getElementById('mDate').value;
    if (!dateVal) { showAlert('일시를 입력하세요', 'warning'); return; }

    const payload = {
        account_number:  document.getElementById('mAccount').value,
        type:            document.getElementById('mType').value,
        amount:          amount,
        transaction_at:  new Date(dateVal).toISOString(),
        memo:            document.getElementById('mMemo').value,
        category:        document.getElementById('mCategory').value,
        notes:           document.getElementById('mNotes').value,
        source:          'manual'
    };
    try {
        const res  = await fetch('/api/bank/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        bootstrap.Modal.getInstance(document.getElementById('manualModal')).hide();
        showAlert('거래 등록 완료');
        loadTransactions();
        loadSummary();
    } catch (e) { showAlert('등록 실패: ' + e.message, 'danger'); }
}

// ==================== 신한해외카드 승인내역 모달 ====================
function openCardModal() {
    const n = new Date();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, '0');
    const last = new Date(y, n.getMonth() + 1, 0).getDate();
    document.getElementById('cardFilterStart').value = `${y}-${m}-01`;
    document.getElementById('cardFilterEnd').value   = `${y}-${m}-${String(last).padStart(2, '0')}`;
    new bootstrap.Modal(document.getElementById('cardModal')).show();
    loadCardLimit();
    loadCardTransactions();
}

async function loadCardLimit() {
    const usd = v => 'USD ' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    try {
        const res  = await fetch('/api/bank/card-limit');
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        document.getElementById('limitBase').textContent  = usd(data.base_limit);
        document.getElementById('limitIn').textContent    = usd(data.total_in);
        document.getElementById('limitUsed').textContent  = usd(data.total_card_used);
        const avail = data.available;
        const el = document.getElementById('limitAvail');
        el.textContent = usd(avail);
        el.style.color = avail >= 0 ? '#667eea' : '#dc3545';
    } catch (e) {
        document.getElementById('limitAvail').textContent = '로드 실패';
    }
}

async function loadCardTransactions() {
    const start = document.getElementById('cardFilterStart').value;
    const end   = document.getElementById('cardFilterEnd').value;
    const p = new URLSearchParams({ limit: 100 });
    if (start) p.set('start', start);
    if (end)   p.set('end', end);
    const tbody = document.getElementById('cardTableBody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3 text-muted">조회 중...</td></tr>';
    try {
        const res  = await fetch('/api/bank/card-transactions?' + p.toString());
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        document.getElementById('cardTxCount').textContent = `총 ${data.total}건`;
        if (!data.data.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">내역 없음</td></tr>';
            return;
        }
        tbody.innerHTML = data.data.map(tx => {
            const dt = new Date(new Date(tx.transaction_at).getTime() + 9 * 60 * 60 * 1000);
            const ds = `${dt.getUTCMonth()+1}/${dt.getUTCDate()} ${String(dt.getUTCHours()).padStart(2,'0')}:${String(dt.getUTCMinutes()).padStart(2,'0')}`;
            const cardNo = tx.account_alias || tx.account_number;
            return `<tr>
                <td style="white-space:nowrap;font-size:.78rem">${ds}</td>
                <td><small>${cardNo}</small></td>
                <td class="text-end fw-bold c-red">${tx.amount.toLocaleString('en-US', {minimumFractionDigits:2})} USD</td>
                <td>${tx.memo || '-'}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-3 text-danger">로드 실패: ${e.message}</td></tr>`;
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-danger">로드 실패: ${e.message}</td></tr>`;
    }
}

// ==================== 카드 수동 등록 ====================
async function previewCardManual() {
    const msg = document.getElementById('cardManualMsg').value.trim();
    const preview = document.getElementById('cardManualPreview');
    if (!msg) { preview.style.display = 'none'; return; }
    try {
        const r = await fetch('/api/bank/card-test?msg=' + encodeURIComponent(msg));
        const d = await r.json();
        if (!d.parsed) {
            preview.style.display = 'block';
            preview.innerHTML = '<span class="text-danger"><i class="fas fa-times-circle me-1"></i>파싱 실패 - 신한법인해외승인 문자 형식 확인 필요</span>';
            return;
        }
        const p = d.parsed;
        const dt = new Date(new Date(p.transaction_at).getTime() + 9 * 60 * 60 * 1000);
        const ds = `${dt.getUTCMonth()+1}/${dt.getUTCDate()} ${String(dt.getUTCHours()).padStart(2,'0')}:${String(dt.getUTCMinutes()).padStart(2,'0')}`;
        preview.style.display = 'block';
        preview.innerHTML = `<span class="text-success"><i class="fas fa-check-circle me-1"></i>파싱 성공</span>
            &nbsp;|&nbsp; 일시: <strong>${ds}</strong>
            &nbsp;|&nbsp; 카드: <strong>${p.card_number}</strong>
            &nbsp;|&nbsp; 금액: <strong class="text-danger">USD ${p.amount.toLocaleString('en-US',{minimumFractionDigits:2})}</strong>
            &nbsp;|&nbsp; 가맹점: <strong>${p.memo}</strong>`;
    } catch (e) {
        preview.style.display = 'block';
        preview.innerHTML = '<span class="text-danger">오류: ' + e.message + '</span>';
    }
}

async function submitCardManual() {
    const msg = document.getElementById('cardManualMsg').value.trim();
    if (!msg) { alert('문자 내용을 입력하세요.'); return; }
    if (!msg.includes('신한법인해외승인')) { alert('신한법인해외승인 문자만 등록 가능합니다.'); return; }
    if (!confirm('카드승인 내역으로 등록하시겠습니까?')) return;
    try {
        const r = await fetch('/api/bank/card-webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: msg
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        document.getElementById('cardManualMsg').value = '';
        document.getElementById('cardManualPreview').style.display = 'none';
        showAlert('카드승인 내역이 등록되었습니다.');
        loadCardLimit();
        loadCardTransactions();
    } catch (e) { showAlert('등록 실패: ' + e.message, 'danger'); }
}

// ==================== 웹훅 안내 모달 ====================
function openWebhookModal() {
    document.getElementById('webhookUrl').value = window.location.origin + '/api/bank/webhook';
    new bootstrap.Modal(document.getElementById('webhookModal')).show();
}

function copyWebhook() {
    const el = document.getElementById('webhookUrl');
    el.select();
    document.execCommand('copy');
    showAlert('웹훅 URL이 복사되었습니다');
}

// ==================== 분류 항목 관리 ====================
let catMgmtData = [];   // 전체 카테고리 목록 (비활성 포함)
let catMgmtCurrentType = 'in';

async function openCatMgmtModal() {
    new bootstrap.Modal(document.getElementById('catMgmtModal')).show();
    resetCatForm();
    await loadCatMgmtList();
}

async function loadCatMgmtList() {
    document.getElementById('catMgmtTableBody').innerHTML =
        '<tr><td colspan="8" class="text-center py-3 text-muted">불러오는 중...</td></tr>';
    try {
        const res  = await fetch('/api/bank/categories/all');
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        catMgmtData = data.data;
        renderCatMgmtTable(catMgmtCurrentType);
    } catch (e) {
        document.getElementById('catMgmtTableBody').innerHTML =
            `<tr><td colspan="8" class="text-center text-danger py-3">로드 실패: ${e.message}</td></tr>`;
    }
}

function switchCatTab(type, btn) {
    catMgmtCurrentType = type;
    document.querySelectorAll('#catMgmtTab .nav-link').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // 폼 구분도 변경
    document.getElementById('catFormType').value = type;
    renderCatMgmtTable(type);
}

function renderCatMgmtTable(type) {
    const filtered = catMgmtData.filter(c => c.type === type || c.type === 'both');
    const tbody = document.getElementById('catMgmtTableBody');
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">항목 없음</td></tr>';
        return;
    }
    tbody.innerHTML = filtered.map(c => {
        const activeBtn = c.is_active
            ? `<span class="badge bg-success">활성</span>`
            : `<span class="badge bg-secondary">비활성</span>`;
        const vatTax  = c.vat_taxable   ? '<span class="badge bg-success">🟢 과세</span>' : '-';
        const vatDed  = c.vat_deductible? '<span class="badge bg-primary">🔵 공제</span>' : '-';
        const keywords = (c.keywords || []).filter(Boolean).join(', ') || '-';
        const isDefault = c.code === 'uncategorized';
        return `<tr class="${c.is_active ? '' : 'table-secondary text-muted'}">
            <td><code style="font-size:.75rem">${c.code}</code></td>
            <td class="fw-bold">${c.label}</td>
            <td class="text-center">${vatTax}</td>
            <td class="text-center">${vatDed}</td>
            <td style="max-width:180px;font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${keywords}">${keywords}</td>
            <td style="font-size:.75rem">${c.description || '-'}</td>
            <td class="text-center">${activeBtn}</td>
            <td class="text-center">
                <button class="btn btn-outline-primary btn-sm py-0 px-2" style="font-size:.72rem" onclick="editCatMgmt('${c._id}')">수정</button>
                ${!isDefault ? `<button class="btn btn-outline-${c.is_active ? 'danger' : 'success'} btn-sm py-0 px-2 ms-1" style="font-size:.72rem" onclick="toggleCatActive('${c._id}', ${!c.is_active})">${c.is_active ? '비활성' : '복원'}</button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

function editCatMgmt(id) {
    const cat = catMgmtData.find(c => c._id === id);
    if (!cat) return;
    document.getElementById('catEditId').value         = cat._id;
    document.getElementById('catFormCode').value       = cat.code;
    document.getElementById('catFormCode').disabled    = true;  // 코드는 수정 불가
    document.getElementById('catFormLabel').value      = cat.label;
    document.getElementById('catFormType').value       = cat.type;
    document.getElementById('catFormSort').value       = cat.sort_order || 0;
    document.getElementById('catFormVatTaxable').checked = !!cat.vat_taxable;
    document.getElementById('catFormVatDeduct').checked  = !!cat.vat_deductible;
    document.getElementById('catFormKeywords').value   = (cat.keywords || []).join(', ');
    document.getElementById('catFormDesc').value       = cat.description || '';
    document.getElementById('catFormTitle').innerHTML  = '<i class="fas fa-edit me-2"></i>분류 항목 수정';
    document.getElementById('catFormTitle').style.background = '#fff3cd';
    // 폼으로 스크롤
    document.getElementById('catFormCode').closest('.section-card').scrollIntoView({ behavior: 'smooth' });
}

function resetCatForm() {
    document.getElementById('catEditId').value         = '';
    document.getElementById('catFormCode').value       = '';
    document.getElementById('catFormCode').disabled    = false;
    document.getElementById('catFormLabel').value      = '';
    document.getElementById('catFormType').value       = catMgmtCurrentType;
    document.getElementById('catFormSort').value       = '0';
    document.getElementById('catFormVatTaxable').checked = false;
    document.getElementById('catFormVatDeduct').checked  = false;
    document.getElementById('catFormKeywords').value   = '';
    document.getElementById('catFormDesc').value       = '';
    document.getElementById('catFormTitle').innerHTML  = '<i class="fas fa-plus me-2"></i>새 분류 항목 추가';
    document.getElementById('catFormTitle').style.background = '';
}

async function saveCatMgmt() {
    const id       = document.getElementById('catEditId').value;
    const code     = document.getElementById('catFormCode').value.trim();
    const label    = document.getElementById('catFormLabel').value.trim();
    const type     = document.getElementById('catFormType').value;
    const sort     = parseInt(document.getElementById('catFormSort').value) || 0;
    const vatTax   = document.getElementById('catFormVatTaxable').checked;
    const vatDed   = document.getElementById('catFormVatDeduct').checked;
    const keywords = document.getElementById('catFormKeywords').value;
    const desc     = document.getElementById('catFormDesc').value.trim();

    if (!label || !type) { showAlert('표시명과 구분은 필수입니다.', 'warning'); return; }
    if (!id && !code)    { showAlert('코드를 입력하세요.', 'warning'); return; }

    const payload = { label, type, sort_order: sort, vat_taxable: vatTax, vat_deductible: vatDed, keywords, description: desc };

    try {
        let res;
        if (id) {
            res = await fetch(`/api/bank/categories/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } else {
            res = await fetch('/api/bank/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, code }),
            });
        }
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        showAlert(id ? '수정 완료!' : '추가 완료!');
        resetCatForm();
        await loadCatMgmtList();
        // 거래 분류 선택 셀렉트 갱신
        await loadCategories();
    } catch (e) { showAlert('저장 실패: ' + e.message, 'danger'); }
}

async function toggleCatActive(id, activate) {
    const cat = catMgmtData.find(c => c._id === id);
    const action = activate ? '복원' : '비활성화';
    if (!confirm(`"${cat?.label}" 항목을 ${action}하시겠습니까?`)) return;
    try {
        const res  = await fetch(`/api/bank/categories/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: activate }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        showAlert(`${action} 완료`);
        await loadCatMgmtList();
        await loadCategories();
    } catch (e) { showAlert('처리 실패: ' + e.message, 'danger'); }
}

// ==================== 자동 분류 일괄 적용 ====================
async function applyAutoClassify(force = false) {
    const msg = force
        ? '미확정 거래 전체를 현재 키워드 룰로 재분류합니다.\n(이미 분류된 미확정 거래도 변경될 수 있습니다)\n계속하시겠습니까?'
        : '미분류(uncategorized) 거래에 현재 키워드 룰을 적용합니다.\n계속하시겠습니까?';
    if (!confirm(msg)) return;

    try {
        const res  = await fetch('/api/bank/auto-classify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        showAlert(`✅ ${data.message} (대상 ${data.total}건 중 ${data.updated}건 변경)`);
        // 거래 목록 새로고침
        await loadTransactions();
    } catch (e) {
        showAlert('자동 분류 실패: ' + e.message, 'danger');
    }
}

// ==================== 엑셀 일괄 등록 ====================
let excelPreviewData = []; // 미리보기 파싱 결과 임시 저장

function openExcelModal() {
    resetExcelModal();
    new bootstrap.Modal(document.getElementById('excelModal')).show();
}

function resetExcelModal() {
    excelPreviewData = [];
    document.getElementById('excelStep1').style.display = '';
    document.getElementById('excelStep2').style.display = 'none';
    document.getElementById('excelLoading').style.display = 'none';
    document.getElementById('btnDoImport').style.display = 'none';
    document.getElementById('excelFile').value = '';
    document.getElementById('excelAccount').value = '';
    document.getElementById('excelPreviewBody').innerHTML = '';
    document.getElementById('excelErrorBox').style.display = 'none';
}

async function previewExcel() {
    const account = document.getElementById('excelAccount').value;
    const fileInput = document.getElementById('excelFile');
    if (!account) { showAlert('계좌를 선택하세요.', 'warning'); return; }
    if (!fileInput.files || !fileInput.files[0]) { showAlert('엑셀 파일을 선택하세요.', 'warning'); return; }

    // 로딩 표시
    document.getElementById('excelStep1').style.display = 'none';
    document.getElementById('excelStep2').style.display = 'none';
    document.getElementById('excelLoading').style.display = '';
    document.getElementById('excelLoadingMsg').textContent = '파일을 파싱하는 중...';

    try {
        const formData = new FormData();
        formData.append('excel', fileInput.files[0]);
        formData.append('account_number', account);

        const res = await fetch('/api/bank/excel-preview', { method: 'POST', body: formData });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        excelPreviewData = data.rows;

        // 요약 표시
        const inRows  = data.rows.filter(r => r.type === 'in');
        const outRows = data.rows.filter(r => r.type === 'out');
        const inTotal  = inRows.reduce((s, r) => s + r.amount, 0);
        const outTotal = outRows.reduce((s, r) => s + r.amount, 0);

        const accountLabels = {
            '140-013-623890': '신한원화1 (140-013-623890)',
            '140-014-014440': '신한원화2 (140-014-014440)',
            '140-014-174143': '신한원화3 (140-014-174143)',
            '180-011-678887': '신한외환 (180-011-678887)',
        };
        document.getElementById('exSumAccount').textContent = accountLabels[account] || account;
        document.getElementById('exSumTotal').textContent   = data.total + '건';
        document.getElementById('exSumIn').textContent      = `입금 ${inRows.length}건 (${fmt(inTotal)}원)`;
        document.getElementById('exSumOut').textContent     = `출금 ${outRows.length}건 (${fmt(outTotal)}원)`;
        document.getElementById('exSumErr').textContent     = data.errors.length + '건';

        // 오류 표시
        if (data.errors.length > 0) {
            document.getElementById('excelErrorBox').style.display = '';
            const ul = document.getElementById('excelErrorList');
            ul.innerHTML = data.errors.map(e => `<li>행 ${e.row}: ${e.reason}</li>`).join('');
        } else {
            document.getElementById('excelErrorBox').style.display = 'none';
        }

        // 미리보기 테이블 렌더링
        renderExcelPreviewTable(data.rows);

        // 화면 전환
        document.getElementById('excelLoading').style.display = 'none';
        document.getElementById('excelStep2').style.display = '';
        document.getElementById('btnDoImport').style.display = '';

    } catch (e) {
        document.getElementById('excelLoading').style.display = 'none';
        document.getElementById('excelStep1').style.display = '';
        showAlert('파싱 실패: ' + e.message, 'danger');
    }
}

function renderExcelPreviewTable(rows) {
    const tbody = document.getElementById('excelPreviewBody');
    if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">파싱된 데이터가 없습니다.</td></tr>';
        return;
    }

    const catLabel = (cat) => {
        const map = {
            'deposit_trust': '행사비(수탁액)', 'deposit_receivable': '미수금',
            'deposit_refund': '환불입금', 'deposit_insurance': '보험금',
            'deposit_other': '기타입금', 'expense_salary': '급여',
            'expense_ground': '지상비', 'expense_airfare': '항공료',
            'expense_hotel': '숙박비', 'expense_transport': '교통비',
            'expense_meal': '식대', 'expense_entertainment': '접대비',
            'expense_insurance': '여행자보험', 'expense_marketing': '광고/마케팅',
            'expense_office': '사무용품', 'expense_communication': '통신비',
            'expense_tax': '세금/공과금', 'expense_other': '기타경비',
            'uncategorized': '미분류',
        };
        return map[cat] || cat;
    };

    tbody.innerHTML = rows.map((row, idx) => {
        const dt = new Date(row.transaction_at);
        const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
        const badgeClass = row.type === 'in' ? 'badge-in' : 'badge-out';
        const badgeText  = row.type === 'in' ? '입금' : '출금';
        const amtClass   = row.type === 'in' ? 'text-success fw-bold' : 'text-danger fw-bold';
        const currency   = row.currency === 'USD' ? '$' : '₩';
        const catUncat   = row.category === 'uncategorized' ? ' cat-badge uncat' : '';

        return `<tr>
            <td><input type="checkbox" class="excel-row-chk" data-idx="${idx}" checked></td>
            <td style="white-space:nowrap">${dateStr}</td>
            <td><span class="${badgeClass}">${badgeText}</span></td>
            <td class="text-end ${amtClass}">${currency}${fmt(row.amount)}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${row.memo}">${row.memo || '-'}</td>
            <td><span class="cat-badge${catUncat}">${catLabel(row.category)}</span></td>
        </tr>`;
    }).join('');
}

function toggleAllExcelRows(checked) {
    document.querySelectorAll('.excel-row-chk').forEach(chk => chk.checked = checked);
}

async function doExcelImport() {
    // 체크된 항목만 수집
    const checkedIdxs = [];
    document.querySelectorAll('.excel-row-chk:checked').forEach(chk => {
        checkedIdxs.push(parseInt(chk.dataset.idx));
    });

    if (checkedIdxs.length === 0) {
        showAlert('등록할 항목을 1건 이상 선택하세요.', 'warning');
        return;
    }

    if (!confirm(`선택한 ${checkedIdxs.length}건을 등록하시겠습니까?\n등록 후 되돌릴 수 없습니다.`)) return;

    const rowsToImport = checkedIdxs.map(i => excelPreviewData[i]);

    // 로딩
    document.getElementById('excelStep2').style.display = 'none';
    document.getElementById('btnDoImport').style.display = 'none';
    document.getElementById('excelLoading').style.display = '';
    document.getElementById('excelLoadingMsg').textContent = `${checkedIdxs.length}건 등록 중...`;

    try {
        const res = await fetch('/api/bank/excel-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: rowsToImport }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        document.getElementById('excelLoading').style.display = 'none';

        let msg = `✅ ${data.successCount}건 등록 완료!`;
        if (data.errorCount > 0) msg += `\n❌ ${data.errorCount}건 실패`;
        alert(msg);

        bootstrap.Modal.getInstance(document.getElementById('excelModal')).hide();
        loadTransactions();
        loadSummary();

    } catch (e) {
        document.getElementById('excelLoading').style.display = 'none';
        document.getElementById('excelStep2').style.display = '';
        document.getElementById('btnDoImport').style.display = '';
        showAlert('등록 실패: ' + e.message, 'danger');
    }
}
