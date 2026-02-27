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
        [...allCategories.in, ...allCategories.out, ...allCategories.common].forEach(c => {
            CATEGORY_LABELS[c.value] = c.label;
        });
        const fSel = document.getElementById('filterCategory');
        fSel.innerHTML  = '<option value="all">전체</option>';
        fSel.innerHTML += '<optgroup label="─ 입금">'  + allCategories.in.map(c  => `<option value="${c.value}">${c.label}</option>`).join('') + '</optgroup>';
        fSel.innerHTML += '<optgroup label="─ 출금">'  + allCategories.out.map(c => `<option value="${c.value}">${c.label}</option>`).join('') + '</optgroup>';
        fSel.innerHTML += allCategories.common.map(c => `<option value="${c.value}">${c.label}</option>`).join('');
        updateManualCats();
    } catch (e) { console.error('loadCategories:', e); }
}

function updateManualCats() {
    const type = document.getElementById('mType').value;
    const cats = type === 'in'
        ? [...allCategories.in,  ...allCategories.common]
        : [...allCategories.out, ...allCategories.common];
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
            <td class="hide-sm" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem">${tx.notes || ''}</td>
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
            ? [...allCategories.in,  ...allCategories.common]
            : [...allCategories.out, ...allCategories.common];
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
    loadCardTransactions();
}

async function loadCardTransactions() {
    const start = document.getElementById('cardFilterStart').value;
    const end   = document.getElementById('cardFilterEnd').value;
    const p = new URLSearchParams({ limit: 100 });
    if (start) p.set('start', start);
    if (end)   p.set('end', end);
    const tbody = document.getElementById('cardTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted">조회 중...</td></tr>';
    try {
        const res  = await fetch('/api/bank/card-transactions?' + p.toString());
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        document.getElementById('cardTxCount').textContent = `총 ${data.total}건`;
        if (!data.data.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">내역 없음</td></tr>';
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
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.72rem;color:#888" title="${tx.raw_message||''}">${tx.raw_message||''}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-danger">로드 실패: ${e.message}</td></tr>`;
    }
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
