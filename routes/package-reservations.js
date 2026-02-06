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
        const { status, dateType, startDate, endDate, platform, search } = req.query;
        
        const query = {};
        
        // 상태 필터 (reservation_status 사용)
        if (status && status !== 'all') {
            query.reservation_status = status;
        } else if (!status || status === 'all') {
            // 기본적으로 취소 예약 제외
            query.reservation_status = { $ne: 'cancelled' };
        }
        
        // 날짜 필터 (출발일 또는 예약일)
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999); // 종료일 23:59:59까지 포함
            
            if (dateType === 'created') {
                // 예약일 기준
                query.createdAt = {
                    $gte: start,
                    $lte: end
                };
            } else {
                // 출발일 기준 (기본값)
                query['travel_period.departure_date'] = {
                    $gte: start,
                    $lte: end
                };
            }
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
            .sort({ 'travel_period.departure_date': 1 })
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
            reservation_status,
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
            special_requests,
            custom_reservation_number
        } = req.body;
        
        // 예약번호 처리: 입력값이 있으면 사용, 없으면 자동 생성
        const reservation_number = custom_reservation_number && custom_reservation_number.trim() 
            ? custom_reservation_number.trim() 
            : await PackageReservation.generateReservationNumber();
        
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
            reservation_status: reservation_status || 'pending',
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
        
        // 변경사항 추적을 위한 배열
        const changes = [];
        
        // 필드 라벨 매핑
        const fieldLabels = {
            'reservation_status': '예약 상태',
            'platform_name': '예약 채널',
            'package_name': '패키지명',
            'customer.korean_name': '고객 한글명',
            'customer.english_name': '고객 영문명',
            'customer.phone': '고객 전화번호',
            'customer.email': '고객 이메일',
            'travel_period.departure_date': '출발일',
            'travel_period.return_date': '귀국일',
            'people.adult': '성인 인원',
            'people.child': '소아 인원',
            'people.infant': '유아 인원',
            'flight_info.outbound_flight': '출국 편명',
            'flight_info.inbound_flight': '입국 편명',
            'hotel_name': '호텔명',
            'room_type': '룸타입',
            'itinerary': '일정',
            'inclusions': '포함사항',
            'exclusions': '불포함사항',
            'pricing.price_adult': '성인 1인 요금',
            'pricing.price_child': '소아 1인 요금',
            'pricing.price_infant': '유아 1인 요금',
            'pricing.total_selling_price': '총 판매가',
            'pricing.currency': '통화',
            'pricing.exchange_rate': '환율',
            'special_requests': '특별 요청사항',
            'status': '상태'
        };
        
        // 값 포맷팅 함수
        const formatValue = (value, field) => {
            if (value === null || value === undefined) return '-';
            if (field.includes('date')) {
                return new Date(value).toLocaleDateString('ko-KR');
            }
            if (field.includes('price') || field.includes('amount')) {
                return `₩${Number(value).toLocaleString()}`;
            }
            if (field === 'reservation_status') {
                const statusMap = { pending: '대기', confirmed: '확정', cancelled: '취소' };
                return statusMap[value] || value;
            }
            return value;
        };
        
        // 수정 가능한 필드만 업데이트 및 변경사항 추적
        const allowedFields = [
            'reservation_status',
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
        
        // 단순 필드 비교
        const simpleFields = ['reservation_status', 'platform_name', 'package_name', 'hotel_name', 'room_type', 'itinerary', 'inclusions', 'exclusions', 'special_requests', 'status'];
        simpleFields.forEach(field => {
            if (req.body[field] !== undefined && reservation[field] !== req.body[field]) {
                changes.push({
                    field: field,
                    field_label: fieldLabels[field],
                    old_value: formatValue(reservation[field], field),
                    new_value: formatValue(req.body[field], field)
                });
                reservation[field] = req.body[field];
            }
        });
        
        // 중첩 객체 필드 비교
        if (req.body.customer) {
            ['korean_name', 'english_name', 'phone', 'email'].forEach(subField => {
                if (req.body.customer[subField] !== undefined && reservation.customer[subField] !== req.body.customer[subField]) {
                    changes.push({
                        field: `customer.${subField}`,
                        field_label: fieldLabels[`customer.${subField}`],
                        old_value: formatValue(reservation.customer[subField], subField),
                        new_value: formatValue(req.body.customer[subField], subField)
                    });
                }
            });
            reservation.customer = req.body.customer;
        }
        
        if (req.body.travel_period) {
            ['departure_date', 'return_date'].forEach(subField => {
                if (req.body.travel_period[subField] !== undefined) {
                    const oldDate = reservation.travel_period[subField] ? new Date(reservation.travel_period[subField]).toISOString().split('T')[0] : null;
                    const newDate = new Date(req.body.travel_period[subField]).toISOString().split('T')[0];
                    if (oldDate !== newDate) {
                        changes.push({
                            field: `travel_period.${subField}`,
                            field_label: fieldLabels[`travel_period.${subField}`],
                            old_value: formatValue(oldDate, subField),
                            new_value: formatValue(newDate, subField)
                        });
                    }
                }
            });
            reservation.travel_period = req.body.travel_period;
        }
        
        if (req.body.people) {
            ['adult', 'child', 'infant'].forEach(subField => {
                if (req.body.people[subField] !== undefined && reservation.people[subField] !== req.body.people[subField]) {
                    changes.push({
                        field: `people.${subField}`,
                        field_label: fieldLabels[`people.${subField}`],
                        old_value: `${reservation.people[subField]}명`,
                        new_value: `${req.body.people[subField]}명`
                    });
                }
            });
            reservation.people = req.body.people;
        }
        
        if (req.body.flight_info) {
            reservation.flight_info = req.body.flight_info;
        }
        
        if (req.body.pricing) {
            ['price_adult', 'price_child', 'price_infant', 'total_selling_price', 'currency', 'exchange_rate'].forEach(subField => {
                if (req.body.pricing[subField] !== undefined && reservation.pricing[subField] !== req.body.pricing[subField]) {
                    changes.push({
                        field: `pricing.${subField}`,
                        field_label: fieldLabels[`pricing.${subField}`],
                        old_value: formatValue(reservation.pricing[subField], subField),
                        new_value: formatValue(req.body.pricing[subField], subField)
                    });
                }
            });
            reservation.pricing = req.body.pricing;
        }
        
        if (req.body.guests) {
            reservation.guests = req.body.guests;
        }
        
        if (req.body.billings) {
            reservation.billings = req.body.billings;
        }
        
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
        
        // 수정 이력 추가
        if (changes.length > 0) {
            const modificationEntry = {
                modified_at: new Date(),
                modified_by: req.session.adminUsername || req.session.adminId || '관리자',
                changes: changes,
                summary: `${changes.length}개 필드 수정됨`
            };
            
            if (!reservation.modification_history) {
                reservation.modification_history = [];
            }
            reservation.modification_history.push(modificationEntry);
        }
        
        await reservation.save();
        
        console.log('✅ 패키지 예약 수정 완료:', reservation.reservation_number, `(${changes.length}개 변경)`);
        
        res.json({
            success: true,
            message: '패키지 예약이 수정되었습니다.',
            data: reservation,
            changes_count: changes.length
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

// 수배서 생성 (발송 시간 기록 및 이력 저장)
router.post('/:id/assignment/:componentIndex', requireAuth, async (req, res) => {
    try {
        const { id, componentIndex } = req.params;
        const reservation = await PackageReservation.findById(id);
        
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }

        const index = parseInt(componentIndex);
        if (index < 0 || index >= reservation.cost_components.length) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 구성요소 인덱스입니다.'
            });
        }

        const now = new Date();
        const component = reservation.cost_components[index];
        
        // 구성요소 타입 이름
        const componentTypeNames = {
            flight: '항공권',
            hotel: '호텔',
            tour: '투어',
            ground: '지상비',
            other: '기타'
        };
        
        // 수배서 발송 시간 기록 (최신 정보)
        reservation.cost_components[index].assignment_sent_at = now;
        
        // 수배서 생성 이력에 추가 (예약 데이터 스냅샷 포함)
        if (!reservation.cost_components[index].assignment_history) {
            reservation.cost_components[index].assignment_history = [];
        }
        
        reservation.cost_components[index].assignment_history.push({
            created_at: now,
            created_by: req.session.user?.username || 'admin',
            snapshot: {
                // 기본 예약 정보
                reservation_number: reservation.reservation_number,
                reservation_status: reservation.reservation_status,
                platform_name: reservation.platform_name,
                package_name: reservation.package_name,
                
                // 여행 기간
                departure_date: reservation.travel_period.departure_date,
                return_date: reservation.travel_period.return_date,
                nights: reservation.travel_period.nights,
                days: reservation.travel_period.days,
                
                // 항공편 정보
                flight_info: reservation.flight_info || {},
                
                // 호텔 정보
                hotel_name: reservation.hotel_name,
                room_type: reservation.room_type,
                
                // 인원 정보
                adult_count: reservation.people.adult,
                child_count: reservation.people.child,
                infant_count: reservation.people.infant,
                
                // 고객 정보
                customer_name: reservation.customer.korean_name,
                english_name: reservation.customer.english_name,
                phone_number: reservation.customer.phone,
                email: reservation.customer.email,
                
                // 투숙객 정보
                guests: reservation.guests || [],
                
                // 일정 및 포함/불포함 사항
                itinerary: reservation.itinerary,
                inclusions: reservation.inclusions,
                exclusions: reservation.exclusions,
                
                // 특별 요청사항
                special_requests: reservation.special_requests,
                
                // 구성요소 정보
                component_type: componentTypeNames[component.component_type] || component.component_type,
                vendor_name: component.vendor_name,
                cost_amount: component.cost_amount,
                cost_currency: component.cost_currency,
                cost_krw: component.cost_krw,
                notes: component.notes
            }
        });
        
        await reservation.save();

        console.log('✅ 수배서 생성:', reservation.reservation_number, '- 구성요소', index);

        res.json({
            success: true,
            message: '수배서가 생성되었습니다.',
            history_count: reservation.cost_components[index].assignment_history.length
        });

    } catch (error) {
        console.error('❌ 수배서 생성 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배서 생성 중 오류가 발생했습니다.'
        });
    }
});

// 수배서 이메일 발송
router.post('/:id/assignment/:componentIndex/email', requireAuth, async (req, res) => {
    try {
        const { id, componentIndex } = req.params;
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({
                success: false,
                message: '이메일 주소가 필요합니다.'
            });
        }

        const reservation = await PackageReservation.findById(id);
        
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }

        const index = parseInt(componentIndex);
        if (index < 0 || index >= reservation.cost_components.length) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 구성요소 인덱스입니다.'
            });
        }

        const component = reservation.cost_components[index];
        
        // 수배서 발송 시간 기록
        reservation.cost_components[index].assignment_sent_at = new Date();
        reservation.cost_components[index].assignment_email = email;
        await reservation.save();

        // TODO: 실제 이메일 발송 로직 구현 (Nodemailer 등 사용)
        console.log('✅ 수배서 이메일 발송:', email, '- 예약번호:', reservation.reservation_number);

        res.json({
            success: true,
            message: `수배서가 ${email}로 발송되었습니다.`
        });

    } catch (error) {
        console.error('❌ 수배서 이메일 발송 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배서 이메일 발송 중 오류가 발생했습니다.'
        });
    }
});

// 수배서 링크 생성
router.get('/:id/assignment/:componentIndex/link', requireAuth, async (req, res) => {
    try {
        const { id, componentIndex } = req.params;
        const reservation = await PackageReservation.findById(id);
        
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }

        const index = parseInt(componentIndex);
        if (index < 0 || index >= reservation.cost_components.length) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 구성요소 인덱스입니다.'
            });
        }

        // 수배서 링크 생성
        const link = `${req.protocol}://${req.get('host')}/api/package-reservations/${id}/assignment/${componentIndex}/view`;

        res.json({
            success: true,
            link: link
        });

    } catch (error) {
        console.error('❌ 수배서 링크 생성 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배서 링크 생성 중 오류가 발생했습니다.'
        });
    }
});

// 수배서 수신 확인 (공개 엔드포인트 - 인증 불필요)
router.post('/:id/assignment/:componentIndex/confirm', async (req, res) => {
    try {
        const { id, componentIndex } = req.params;
        const reservation = await PackageReservation.findById(id);
        
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }

        const index = parseInt(componentIndex);
        if (index < 0 || index >= reservation.cost_components.length) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 구성요소 인덱스입니다.'
            });
        }

        // 수배서 수신 확인 시간 기록 (최초 1회만)
        if (!reservation.cost_components[index].assignment_confirmed_at) {
            reservation.cost_components[index].assignment_confirmed_at = new Date();
            await reservation.save();
            
            console.log('✅ 수배서 수신 확인:', reservation.reservation_number, '- 구성요소', index);
        }

        res.json({
            success: true,
            message: '수배서 수신이 확인되었습니다.'
        });

    } catch (error) {
        console.error('❌ 수배서 수신 확인 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배서 수신 확인 중 오류가 발생했습니다.'
        });
    }
});

// 수배서 페이지 뷰 (공개 엔드포인트 - 인증 불필요)
router.get('/:id/assignment/:componentIndex/view', async (req, res) => {
    try {
        const { id, componentIndex } = req.params;
        const reservation = await PackageReservation.findById(id);
        
        if (!reservation) {
            return res.status(404).render('error', {
                message: '예약을 찾을 수 없습니다.'
            });
        }

        const index = parseInt(componentIndex);
        if (index < 0 || index >= reservation.cost_components.length) {
            return res.status(400).render('error', {
                message: '유효하지 않은 구성요소 인덱스입니다.'
            });
        }

        const component = reservation.cost_components[index];
        
        // 구성요소 타입 이름
        const componentTypeNames = {
            flight: '항공권',
            hotel: '호텔',
            tour: '투어',
            ground: '지상비',
            other: '기타'
        };

        // 수배서 데이터 구성 (전체 예약 정보 포함)
        const assignmentData = {
            // 기본 예약 정보
            reservation_number: reservation.reservation_number,
            reservation_status: reservation.reservation_status,
            platform_name: reservation.platform_name,
            package_name: reservation.package_name,
            
            // 여행 기간
            departure_date: reservation.travel_period.departure_date,
            return_date: reservation.travel_period.return_date,
            nights: reservation.travel_period.nights,
            days: reservation.travel_period.days,
            
            // 항공편 정보
            flight_info: reservation.flight_info || {},
            
            // 호텔 정보
            hotel_name: reservation.hotel_name,
            room_type: reservation.room_type,
            
            // 인원 정보
            adult_count: reservation.people.adult,
            child_count: reservation.people.child,
            infant_count: reservation.people.infant,
            
            // 고객 정보
            customer_name: reservation.customer.korean_name,
            english_name: reservation.customer.english_name,
            phone_number: reservation.customer.phone,
            email: reservation.customer.email,
            
            // 투숙객 정보
            guests: reservation.guests || [],
            
            // 일정 및 포함/불포함 사항
            itinerary: reservation.itinerary,
            inclusions: reservation.inclusions,
            exclusions: reservation.exclusions,
            
            // 특별 요청사항
            special_requests: reservation.special_requests,
            
            // 구성요소 정보
            component_type: componentTypeNames[component.component_type] || component.component_type,
            vendor_name: component.vendor_name,
            cost_amount: component.cost_amount,
            cost_currency: component.cost_currency,
            cost_krw: component.cost_krw,
            notes: component.notes,
            
            // 수배서 상태
            assignment_sent_at: component.assignment_sent_at,
            assignment_confirmed_at: component.assignment_confirmed_at,
            assignment_email: component.assignment_email
        };

        res.render('package-assignment', {
            title: `수배서 - ${reservation.reservation_number}`,
            assignment: assignmentData,
            reservationId: id,
            componentIndex: index
        });

    } catch (error) {
        console.error('❌ 수배서 페이지 로드 실패:', error);
        res.status(500).render('error', {
            message: '수배서 페이지 로드 중 오류가 발생했습니다.'
        });
    }
});

// 확정서 뷰
router.get('/:id/confirmation/view', async (req, res) => {
    try {
        const { id } = req.params;
        const reservation = await PackageReservation.findById(id);
        
        if (!reservation) {
            return res.status(404).render('error', {
                message: '예약을 찾을 수 없습니다.'
            });
        }

        console.log('📄 확정서 데이터:', {
            reservation_number: reservation.reservation_number,
            people: reservation.people,
            pricing: reservation.pricing
        });

        // 안전한 데이터 접근
        const adultCount = reservation.people?.adult || 0;
        const childCount = reservation.people?.child || 0;
        const infantCount = reservation.people?.infant || 0;
        
        const adultPrice = reservation.pricing?.price_adult || 0;
        const childPrice = reservation.pricing?.price_child || 0;
        const infantPrice = reservation.pricing?.price_infant || 0;

        // 총 판매가 계산
        const adultTotal = adultPrice * adultCount;
        const childTotal = childPrice * childCount;
        const infantTotal = infantPrice * infantCount;
        const adjustmentsTotal = (reservation.pricing?.adjustments || []).reduce((sum, adj) => sum + (adj.amount || 0), 0);
        const totalAmount = adultTotal + childTotal + infantTotal + adjustmentsTotal;

        console.log('💰 금액 계산:', {
            adultCount, adultPrice, adultTotal,
            childCount, childPrice, childTotal,
            infantCount, infantPrice, infantTotal,
            adjustmentsTotal,
            totalAmount
        });

        // 확정서 데이터 구성
        const confirmationData = {
            // 기본 예약 정보
            reservation_number: reservation.reservation_number,
            reservation_status: reservation.reservation_status,
            platform_name: reservation.platform_name,
            package_name: reservation.package_name,
            
            // 여행 기간
            departure_date: reservation.travel_period?.departure_date,
            return_date: reservation.travel_period?.return_date,
            nights: reservation.travel_period?.nights || 0,
            days: reservation.travel_period?.days || 0,
            
            // 항공편 정보
            flight_info: reservation.flight_info || {},
            
            // 호텔 정보
            hotel_name: reservation.hotel_name,
            room_type: reservation.room_type,
            
            // 인원 정보
            adult_count: adultCount,
            child_count: childCount,
            infant_count: infantCount,
            
            // 인원별 판매가
            adult_price: adultPrice,
            child_price: childPrice,
            infant_price: infantPrice,
            
            // 금액 변동 사항
            adjustments: reservation.pricing?.adjustments || [],
            
            // 총 판매가
            total_amount: totalAmount,
            
            // 고객 정보
            customer_name: reservation.customer?.korean_name || '',
            english_name: reservation.customer?.english_name || '',
            phone_number: reservation.customer?.phone || '',
            email: reservation.customer?.email || '',
            
            // 투숙객 정보
            guests: reservation.guests || [],
            
            // 일정 및 포함/불포함 사항
            itinerary: reservation.itinerary,
            inclusions: reservation.inclusions,
            exclusions: reservation.exclusions,
            
            // 특별 요청사항
            special_requests: reservation.special_requests
        };

        res.render('package-confirmation', {
            title: `확정서 - ${reservation.reservation_number}`,
            confirmation: confirmationData,
            reservationId: id
        });

    } catch (error) {
        console.error('❌ 확정서 페이지 로드 실패:', error);
        res.status(500).render('error', {
            message: '확정서 페이지 로드 중 오류가 발생했습니다.'
        });
    }
});

module.exports = router;
