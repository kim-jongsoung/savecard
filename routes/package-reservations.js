const express = require('express');
const router = express.Router();
const PackageReservation = require('../models/PackageReservation');

// 인증 미들웨어
const requireAuth = (req, res, next) => {
    if (!req.session.adminId) {
        return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
    }
    next();
};

// 패키지 예약 목록 조회
router.get('/', requireAuth, async (req, res) => {
    try {
        const { status, startDate, endDate, platform, search } = req.query;
        
        const query = {};
        
        // 상태 필터
        if (status && status !== 'all') {
            query.status = status;
        }
        
        // 날짜 필터
        if (startDate && endDate) {
            query['travel_period.departure_date'] = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }
        
        // 플랫폼 필터
        if (platform) {
            query.platform_name = platform;
        }
        
        // 검색 (예약번호, 고객명)
        if (search) {
            query.$or = [
                { reservation_number: new RegExp(search, 'i') },
                { 'customer.korean_name': new RegExp(search, 'i') },
                { 'customer.english_name': new RegExp(search, 'i') }
            ];
        }
        
        const reservations = await PackageReservation.find(query)
            .sort({ createdAt: -1 })
            .lean();
        
        res.json({
            success: true,
            data: reservations,
            count: reservations.length
        });
        
    } catch (error) {
        console.error('❌ 패키지 예약 목록 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '패키지 예약 목록 조회 중 오류가 발생했습니다.'
        });
    }
});

// 패키지 예약 상세 조회
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const reservation = await PackageReservation.findById(req.params.id).lean();
        
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: '패키지 예약을 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            data: reservation
        });
        
    } catch (error) {
        console.error('❌ 패키지 예약 상세 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '패키지 예약 상세 조회 중 오류가 발생했습니다.'
        });
    }
});

// 패키지 예약 등록
router.post('/', requireAuth, async (req, res) => {
    try {
        const {
            platform_name,
            package_name,
            customer,
            guests,
            travel_period,
            people,
            flight_info,
            hotel_name,
            room_type,
            itinerary,
            inclusions,
            exclusions,
            pricing,
            billings,
            cost_components,
            special_requests
        } = req.body;
        
        // 예약번호 자동 생성
        const reservation_number = await PackageReservation.generateReservationNumber();
        
        // 구성요소 원화 환산
        const processedComponents = cost_components.map(component => {
            const cost_krw = component.cost_currency === 'KRW'
                ? component.cost_amount
                : component.cost_amount * pricing.exchange_rate;
            
            return {
                ...component,
                cost_krw: Math.round(cost_krw)
            };
        });
        
        // 새 예약 생성
        const newReservation = new PackageReservation({
            reservation_number,
            platform_name,
            package_name,
            customer,
            guests,
            travel_period,
            people,
            flight_info,
            hotel_name,
            room_type,
            itinerary,
            inclusions,
            exclusions,
            pricing,
            billings,
            cost_components: processedComponents,
            special_requests,
            status: 'confirmed'
        });
        
        // 저장 (자동으로 정산 금액 계산됨)
        await newReservation.save();
        
        console.log('✅ 패키지 예약 등록 완료:', reservation_number);
        
        res.json({
            success: true,
            message: '패키지 예약이 등록되었습니다.',
            data: newReservation
        });
        
    } catch (error) {
        console.error('❌ 패키지 예약 등록 실패:', error);
        console.error('에러 상세:', error);
        res.status(500).json({
            success: false,
            message: '패키지 예약 등록 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

// 패키지 예약 수정
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const reservation = await PackageReservation.findById(req.params.id);
        
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: '패키지 예약을 찾을 수 없습니다.'
            });
        }
        
        // 수정 가능한 필드만 업데이트
        const allowedFields = [
            'platform_name',
            'package_name',
            'customer',
            'guests',
            'travel_period',
            'people',
            'flight_info',
            'hotel_name',
            'room_type',
            'itinerary',
            'inclusions',
            'exclusions',
            'pricing',
            'billings',
            'cost_components',
            'special_requests',
            'status'
        ];
        
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                reservation[field] = req.body[field];
            }
        });
        
        // 구성요소 원화 환산
        if (req.body.cost_components) {
            reservation.cost_components = req.body.cost_components.map(component => {
                const cost_krw = component.cost_currency === 'KRW'
                    ? component.cost_amount
                    : component.cost_amount * reservation.pricing.exchange_rate;
                
                return {
                    ...component,
                    cost_krw: Math.round(cost_krw)
                };
            });
        }
        
        await reservation.save();
        
        console.log('✅ 패키지 예약 수정 완료:', reservation.reservation_number);
        
        res.json({
            success: true,
            message: '패키지 예약이 수정되었습니다.',
            data: reservation
        });
        
    } catch (error) {
        console.error('❌ 패키지 예약 수정 실패:', error);
        res.status(500).json({
            success: false,
            message: '패키지 예약 수정 중 오류가 발생했습니다.'
        });
    }
});

// 패키지 예약 삭제
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const reservation = await PackageReservation.findByIdAndDelete(req.params.id);
        
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: '패키지 예약을 찾을 수 없습니다.'
            });
        }
        
        console.log('✅ 패키지 예약 삭제 완료:', reservation.reservation_number);
        
        res.json({
            success: true,
            message: '패키지 예약이 삭제되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ 패키지 예약 삭제 실패:', error);
        res.status(500).json({
            success: false,
            message: '패키지 예약 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 패키지 정산 통계
router.get('/stats/summary', requireAuth, async (req, res) => {
    try {
        const stats = await PackageReservation.aggregate([
            {
                $group: {
                    _id: '$settlement.settlement_status',
                    count: { $sum: 1 },
                    total_revenue: { $sum: '$settlement.total_revenue_krw' },
                    total_cost: { $sum: '$settlement.total_cost_krw' },
                    total_margin: { $sum: '$settlement.total_margin_krw' }
                }
            }
        ]);
        
        res.json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        console.error('❌ 패키지 정산 통계 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '패키지 정산 통계 조회 중 오류가 발생했습니다.'
        });
    }
});

module.exports = router;
