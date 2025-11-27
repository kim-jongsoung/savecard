const express = require('express');
const router = express.Router();

// 호텔 정산 목록 및 통계 조회
router.get('/', async (req, res) => {
    try {
        const pool = req.app.get('pool');
        
        // 1. 정산 목록 조회 (바우처 전송 완료 이상 상태 + 정산대기)
        const settlementsQuery = `
            SELECT 
                hr.id,
                hr.reservation_number,
                hr.check_in_date,
                hr.check_out_date,
                hr.nights,
                hr.grand_total as total_selling_price,
                hr.total_cost_price,
                hr.agency_fee,
                hr.exchange_rate,
                hr.payment_date,
                hr.transfer_date,
                hr.settlement_memo,
                hr.status,
                h.hotel_name,
                ba.agency_name,
                COALESCE(
                    (SELECT json_agg(json_build_object('name', g->>'name'))
                     FROM jsonb_array_elements(hr.guests) g
                     LIMIT 1),
                    '[]'::json
                ) as guest_info,
                CASE 
                    WHEN hr.payment_date IS NOT NULL AND hr.transfer_date IS NOT NULL THEN true
                    ELSE false
                END as is_settled,
                (hr.grand_total * COALESCE(hr.exchange_rate, 1300)) - 
                (hr.total_cost_price * COALESCE(hr.exchange_rate, 1300)) - 
                COALESCE(hr.agency_fee, 0) as margin
            FROM hotel_reservations hr
            LEFT JOIN hotels h ON hr.hotel_id = h.id
            LEFT JOIN booking_agencies ba ON hr.agency_id = ba.id
            WHERE hr.status IN ('바우처전송완료', '정산완료', '정산대기', 'voucher')
            ORDER BY hr.check_in_date DESC
        `;
        
        const settlementsResult = await pool.query(settlementsQuery);
        const settlements = settlementsResult.rows.map(row => ({
            ...row,
            guest_name: row.guest_info && row.guest_info.length > 0 ? row.guest_info[0].name : 'N/A'
        }));
        
        // 2. 통계 계산
        // 미입금 거래액 (payment_date가 null인 것)
        const unpaidRevenueQuery = `
            SELECT 
                COALESCE(SUM(grand_total * COALESCE(exchange_rate, 1300)), 0) as total
            FROM hotel_reservations
            WHERE status IN ('바우처전송완료', '정산완료', '정산대기', 'voucher')
            AND payment_date IS NULL
        `;
        const unpaidRevenueResult = await pool.query(unpaidRevenueQuery);
        const unpaidRevenue = parseFloat(unpaidRevenueResult.rows[0].total) || 0;
        
        // 거래처별 미입금
        const unpaidByAgencyQuery = `
            SELECT 
                ba.agency_name,
                COALESCE(SUM(hr.grand_total * COALESCE(hr.exchange_rate, 1300)), 0) as total
            FROM hotel_reservations hr
            LEFT JOIN booking_agencies ba ON hr.agency_id = ba.id
            WHERE hr.status IN ('바우처전송완료', '정산완료', '정산대기', 'voucher')
            AND hr.payment_date IS NULL
            GROUP BY ba.agency_name
            HAVING SUM(hr.grand_total * COALESCE(hr.exchange_rate, 1300)) > 0
            ORDER BY total DESC
        `;
        const unpaidByAgencyResult = await pool.query(unpaidByAgencyQuery);
        const unpaidByAgency = unpaidByAgencyResult.rows;
        
        // 미송금 매입액 (transfer_date가 null인 것)
        const unpaidCostQuery = `
            SELECT 
                COALESCE(SUM(total_cost_price * COALESCE(exchange_rate, 1300)), 0) as total
            FROM hotel_reservations
            WHERE status IN ('바우처전송완료', '정산완료', '정산대기', 'voucher')
            AND transfer_date IS NULL
        `;
        const unpaidCostResult = await pool.query(unpaidCostQuery);
        const unpaidCost = parseFloat(unpaidCostResult.rows[0].total) || 0;
        
        // 호텔별 미송금
        const unpaidByHotelQuery = `
            SELECT 
                h.hotel_name,
                COALESCE(SUM(hr.total_cost_price * COALESCE(hr.exchange_rate, 1300)), 0) as total
            FROM hotel_reservations hr
            LEFT JOIN hotels h ON hr.hotel_id = h.id
            WHERE hr.status IN ('바우처전송완료', '정산완료', '정산대기', 'voucher')
            AND hr.transfer_date IS NULL
            GROUP BY h.hotel_name
            HAVING SUM(hr.total_cost_price * COALESCE(hr.exchange_rate, 1300)) > 0
            ORDER BY total DESC
        `;
        const unpaidByHotelResult = await pool.query(unpaidByHotelQuery);
        const unpaidByHotel = unpaidByHotelResult.rows;
        
        // 월간 통계 (이번 달 체크인 기준)
        const monthlyStatsQuery = `
            SELECT 
                COALESCE(SUM((grand_total * COALESCE(exchange_rate, 1300)) - 
                            (total_cost_price * COALESCE(exchange_rate, 1300)) - 
                            COALESCE(agency_fee, 0)), 0) as margin,
                COALESCE(SUM(grand_total * COALESCE(exchange_rate, 1300)), 0) as revenue,
                COALESCE(SUM(total_cost_price * COALESCE(exchange_rate, 1300)), 0) as cost
            FROM hotel_reservations
            WHERE EXTRACT(YEAR FROM check_in_date) = EXTRACT(YEAR FROM CURRENT_DATE)
            AND EXTRACT(MONTH FROM check_in_date) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND status IN ('바우처전송완료', '정산완료', '정산대기', 'voucher')
        `;
        const monthlyStatsResult = await pool.query(monthlyStatsQuery);
        const monthlyStats = monthlyStatsResult.rows[0];
        
        res.json({
            settlements,
            stats: {
                unpaidRevenue,
                unpaidByAgency,
                unpaidCost,
                unpaidByHotel,
                monthlyMargin: parseFloat(monthlyStats.margin) || 0,
                monthlyRevenue: parseFloat(monthlyStats.revenue) || 0,
                monthlyCost: parseFloat(monthlyStats.cost) || 0
            }
        });
    } catch (error) {
        console.error('❌ 호텔 정산 목록 조회 실패:', error);
        res.status(500).json({ error: '정산 목록을 불러오는데 실패했습니다.' });
    }
});

// 정산 상세 조회
router.get('/:id', async (req, res) => {
    try {
        const pool = req.app.get('pool');
        const { id } = req.params;
        
        const query = `
            SELECT 
                hr.*,
                h.hotel_name,
                ba.agency_name,
                COALESCE(
                    (SELECT json_agg(json_build_object('name', g->>'name'))
                     FROM jsonb_array_elements(hr.guests) g
                     LIMIT 1),
                    '[]'::json
                ) as guest_info
            FROM hotel_reservations hr
            LEFT JOIN hotels h ON hr.hotel_id = h.id
            LEFT JOIN booking_agencies ba ON hr.agency_id = ba.id
            WHERE hr.id = $1
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '정산 내역을 찾을 수 없습니다.' });
        }
        
        const settlement = result.rows[0];
        settlement.guest_name = settlement.guest_info && settlement.guest_info.length > 0 
            ? settlement.guest_info[0].name 
            : 'N/A';
        
        res.json(settlement);
    } catch (error) {
        console.error('❌ 정산 상세 조회 실패:', error);
        res.status(500).json({ error: '정산 상세를 불러오는데 실패했습니다.' });
    }
});

// 정산 정보 수정
router.put('/:id', async (req, res) => {
    try {
        const pool = req.app.get('pool');
        const { id } = req.params;
        const {
            total_selling_price,
            total_cost_price,
            exchange_rate,
            agency_fee,
            payment_date,
            transfer_date,
            settlement_memo
        } = req.body;
        
        const query = `
            UPDATE hotel_reservations
            SET 
                grand_total = $1,
                total_cost_price = $2,
                exchange_rate = $3,
                agency_fee = $4,
                payment_date = $5,
                transfer_date = $6,
                settlement_memo = $7,
                status = CASE 
                    WHEN $5 IS NOT NULL AND $6 IS NOT NULL THEN '정산완료'
                    ELSE status
                END,
                updated_at = NOW()
            WHERE id = $8
            RETURNING *
        `;
        
        const result = await pool.query(query, [
            total_selling_price,
            total_cost_price,
            exchange_rate,
            agency_fee,
            payment_date || null,
            transfer_date || null,
            settlement_memo || '',
            id
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '정산 내역을 찾을 수 없습니다.' });
        }
        
        res.json({ success: true, settlement: result.rows[0] });
    } catch (error) {
        console.error('❌ 정산 수정 실패:', error);
        res.status(500).json({ error: '정산 수정에 실패했습니다.' });
    }
});

// 정산 삭제
router.delete('/:id', async (req, res) => {
    try {
        const pool = req.app.get('pool');
        const { id } = req.params;
        
        // 정산 완료 상태를 바우처전송완료로 되돌리고 입출금 정보 삭제
        const query = `
            UPDATE hotel_reservations
            SET 
                payment_date = NULL,
                transfer_date = NULL,
                settlement_memo = NULL,
                status = '바우처전송완료',
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '정산 내역을 찾을 수 없습니다.' });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ 정산 삭제 실패:', error);
        res.status(500).json({ error: '정산 삭제에 실패했습니다.' });
    }
});

// 일괄 입출금 처리
router.post('/bulk-payment', async (req, res) => {
    try {
        const pool = req.app.get('pool');
        const { type, date } = req.body;
        
        let query;
        if (type === 'payment') {
            // 입금 처리
            query = `
                UPDATE hotel_reservations
                SET 
                    payment_date = $1,
                    status = CASE 
                        WHEN transfer_date IS NOT NULL THEN '정산완료'
                        ELSE status
                    END,
                    updated_at = NOW()
                WHERE status IN ('바우처전송완료', '정산완료')
                AND payment_date IS NULL
            `;
        } else {
            // 송금 처리
            query = `
                UPDATE hotel_reservations
                SET 
                    transfer_date = $1,
                    status = CASE 
                        WHEN payment_date IS NOT NULL THEN '정산완료'
                        ELSE status
                    END,
                    updated_at = NOW()
                WHERE status IN ('바우처전송완료', '정산완료')
                AND transfer_date IS NULL
            `;
        }
        
        const result = await pool.query(query, [date]);
        
        res.json({ success: true, count: result.rowCount });
    } catch (error) {
        console.error('❌ 일괄 입출금 처리 실패:', error);
        res.status(500).json({ error: '일괄 처리에 실패했습니다.' });
    }
});

module.exports = router;
