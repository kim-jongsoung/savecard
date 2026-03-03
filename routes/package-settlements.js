const express = require('express');
const router = express.Router();
const PackageReservation = require('../models/PackageReservation');

// 인증 미들웨어
const requireAuth = (req, res, next) => {
    if (!req.session.adminId) {
        return res.redirect('/admin/login');
    }
    next();
};

// 정산관리 페이지 렌더링
router.get('/', requireAuth, (req, res) => {
    res.render('admin/package-settlements', {
        title: '패키지 정산관리',
        adminName: req.session.adminName || req.session.adminUsername || '관리자'
    });
});

// 정산 목록 API
router.get('/list', requireAuth, async (req, res) => {
    try {
        // 입금이 완료된 예약만 조회 (모든 billings의 status가 completed인 경우)
        const allReservations = await PackageReservation.find({
            reservation_status: { $ne: 'cancelled' }
        }).sort({ 'travel_period.departure_date': -1 });
        
        // 입금 완료 여부 확인
        const settledReservations = allReservations.filter(r => {
            const billings = r.billings || [];
            if (billings.length === 0) return false;
            
            // 모든 빌링이 완료 상태인지 확인
            const allCompleted = billings.every(b => b.status === 'completed');
            
            // 총 받아야 할 금액 계산
            const totalAmount = (r.pricing.total_selling_price || 0) + 
                              ((r.pricing.adjustments || []).reduce((sum, adj) => sum + (adj.amount || 0), 0));
            
            // 입금 완료 금액 계산
            const receivedAmount = billings
                .filter(b => b.status === 'completed')
                .reduce((sum, b) => sum + (b.amount || 0), 0);
            
            // 입금이 완료되었는지 확인 (금액이 일치하고 모든 빌링이 완료 상태)
            return allCompleted && receivedAmount >= totalAmount && totalAmount > 0;
        });
        
        // 매입전 / 매입완료 분류
        const pending = [];
        const completed = [];
        
        settledReservations.forEach(r => {
            const components = r.cost_components || [];
            
            // 모든 구성요소의 송금이 완료되었는지 확인
            const allSent = components.length > 0 && components.every(c => c.payment_sent_date);
            
            if (allSent) {
                completed.push(r);
            } else {
                pending.push(r);
            }
        });
        
        // 통계 계산
        const stats = {
            pending_count: pending.length,
            completed_count: completed.length,
            pending_amount: pending.reduce((sum, r) => sum + (r.settlement.total_cost_krw || 0), 0),
            completed_amount: completed.reduce((sum, r) => sum + (r.settlement.total_cost_krw || 0), 0)
        };
        
        res.json({
            success: true,
            data: {
                pending,
                completed,
                stats
            }
        });
        
    } catch (error) {
        console.error('❌ 정산 목록 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '정산 목록 조회 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

// 정산현황 API - 출발일 기준 수탁/미수/선급/미지급 분류
router.get('/status', requireAuth, async (req, res) => {
    try {
        const now = new Date();
        const reservations = await PackageReservation.find({
            reservation_status: { $ne: 'cancelled' }
        }).sort({ 'travel_period.departure_date': -1 });

        const list = reservations.map(r => {
            const departure = r.travel_period?.departure_date ? new Date(r.travel_period.departure_date) : null;
            const departed = departure ? departure < now : false;

            // 판매금액
            const totalSelling = (r.pricing?.total_selling_price || 0) +
                ((r.pricing?.adjustments || []).reduce((s, a) => s + (a.amount || 0), 0));

            // 입금액 (billings completed 합계)
            const receivedAmount = (r.billings || [])
                .filter(b => b.status === 'completed')
                .reduce((s, b) => s + (b.amount || 0), 0);

            // 미수금 / 수탁액
            const unpaidAmount = Math.max(0, totalSelling - receivedAmount);
            const receivable = departed && unpaidAmount > 0 ? unpaidAmount : 0;   // 미수금
            const deposit = !departed && receivedAmount > 0 ? receivedAmount : 0; // 수탁액

            // 매입 총액
            const totalCost = (r.cost_components || []).reduce((s, c) => s + (c.cost_krw || 0), 0);

            // 송금액 (payment_sent_date 있는 것)
            const sentAmount = (r.cost_components || [])
                .filter(c => c.payment_sent_date)
                .reduce((s, c) => s + (c.payment_sent_amount_krw || c.cost_krw || 0), 0);

            // 미지급금 / 선급금
            const unsettledCost = Math.max(0, totalCost - sentAmount);
            const payable = departed && unsettledCost > 0 ? unsettledCost : 0;    // 미지급금
            const prepaid = !departed && sentAmount > 0 ? sentAmount : 0;          // 선급금

            return {
                _id: r._id,
                reservation_number: r.reservation_number,
                platform_name: r.platform_name,
                customer_name: r.customer?.korean_name || '-',
                departure_date: departure,
                departed,
                total_selling: totalSelling,
                received_amount: receivedAmount,
                unpaid_amount: unpaidAmount,
                receivable,   // 미수금
                deposit,      // 수탁액
                total_cost: totalCost,
                sent_amount: sentAmount,
                unsettled_cost: unsettledCost,
                payable,      // 미지급금
                prepaid,      // 선급금
                margin: receivedAmount - sentAmount,
                currency: r.pricing?.currency || 'KRW'
            };
        });

        // 합계
        const summary = {
            total_receivable: list.reduce((s, r) => s + r.receivable, 0),
            total_deposit: list.reduce((s, r) => s + r.deposit, 0),
            total_payable: list.reduce((s, r) => s + r.payable, 0),
            total_prepaid: list.reduce((s, r) => s + r.prepaid, 0),
        };

        res.json({ success: true, list, summary });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
