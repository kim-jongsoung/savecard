const mongoose = require('mongoose');

const packageReservationSchema = new mongoose.Schema({
    // 예약번호 (자동생성)
    reservation_number: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    
    // 예약 상태
    reservation_status: {
        type: String,
        enum: ['pending', 'confirmed', 'cancelled'],
        default: 'pending'
    },
    
    // 기본 정보
    platform_name: {
        type: String,
        required: true
    },
    package_name: {
        type: String,
        required: true
    },
    
    // 고객 정보 (대표)
    customer: {
        korean_name: {
            type: String,
            required: true
        },
        english_name: String,
        phone: String,
        email: String
    },
    
    // 전체 투숙객 정보
    guests: [{
        korean_name: String,
        english_name: String,
        birth_date: Date,
        phone: String,
        email: String,
        type: {
            type: String,
            enum: ['성인', '소아', '유아']
        },
        gender: {
            type: String,
            enum: ['남자', '여자', '']
        }
    }],
    
    // 여행 기간
    travel_period: {
        departure_date: {
            type: Date,
            required: true
        },
        return_date: {
            type: Date,
            required: true
        },
        nights: Number,
        days: Number
    },
    
    // 항공편 정보
    flight_info: {
        outbound_flight: String,
        outbound_departure_time: String,
        outbound_arrival_time: String,
        inbound_flight: String,
        inbound_departure_time: String,
        inbound_arrival_time: String
    },
    
    // 호텔 정보
    hotel_name: String,
    room_type: String,
    
    // 일정 및 포함/불포함 사항
    itinerary: String,
    inclusions: String,
    exclusions: String,
    
    // 인원
    people: {
        adult: {
            type: Number,
            default: 0
        },
        child: {
            type: Number,
            default: 0
        },
        infant: {
            type: Number,
            default: 0
        }
    },
    
    // 판매 금액
    pricing: {
        price_adult: Number,
        price_child: Number,
        price_infant: Number,
        total_selling_price: {
            type: Number,
            required: true
        },
        currency: {
            type: String,
            enum: ['KRW', 'USD'],
            default: 'KRW'
        },
        exchange_rate: {
            type: Number,
            default: 1300
        }
    },
    
    // 결제 빌링
    billings: [{
        type: {
            type: String,
            enum: ['cash', 'card', 'discount']
        },
        amount: Number,
        date: Date,
        fee: Number,
        actual_amount: Number,
        status: {
            type: String,
            enum: ['pending', 'completed'],
            default: 'pending'
        },
        notes: String
    }],
    
    // 매입 구성요소
    cost_components: [{
        component_type: {
            type: String,
            enum: ['flight', 'hotel', 'tour', 'ground', 'other'],
            required: true
        },
        vendor_name: {
            type: String,
            required: true
        },
        cost_amount: {
            type: Number,
            required: true
        },
        cost_currency: {
            type: String,
            enum: ['KRW', 'USD'],
            default: 'KRW'
        },
        cost_krw: {
            type: Number,
            required: true
        },
        notes: String,
        
        // 송금 정보
        payment_sent_date: Date,
        payment_sent_exchange_rate: Number,
        payment_sent_amount_krw: Number,
        
        // 수배서 정보 (최신 정보)
        assignment_sent_at: Date,
        assignment_confirmed_at: Date,
        assignment_email: String,
        
        // 수배서 생성 이력
        assignment_history: [{
            created_at: {
                type: Date,
                default: Date.now
            },
            sent_at: Date,
            confirmed_at: Date,
            email: String,
            created_by: String
        }]
    }],
    
    // 정산 정보 (pre save 훅에서 자동 계산)
    settlement: {
        total_revenue_krw: {
            type: Number,
            default: 0
        },
        total_cost_krw: {
            type: Number,
            default: 0
        },
        total_margin_krw: {
            type: Number,
            default: 0
        },
        margin_rate: {
            type: Number,
            default: 0
        },
        vat_amount: {
            type: Number,
            default: 0
        },
        
        // 입금 관리
        payment_received_date: Date,
        payment_received_amount: Number,
        
        // 정산 상태
        settlement_status: {
            type: String,
            enum: ['pending', 'partial', 'completed'],
            default: 'pending'
        }
    },
    
    // 예약 상태
    status: {
        type: String,
        enum: ['confirmed', 'completed', 'cancelled'],
        default: 'confirmed'
    },
    
    // 특별 요청사항
    special_requests: String,
    
    // 수정 이력
    modification_history: [{
        modified_at: {
            type: Date,
            default: Date.now
        },
        modified_by: String,
        changes: [{
            field: String,
            field_label: String,
            old_value: mongoose.Schema.Types.Mixed,
            new_value: mongoose.Schema.Types.Mixed
        }],
        summary: String
    }]
    
}, {
    timestamps: true  // createdAt, updatedAt 자동 생성
});

// 인덱스
packageReservationSchema.index({ 'customer.korean_name': 1 });
packageReservationSchema.index({ 'travel_period.departure_date': 1 });
packageReservationSchema.index({ 'settlement.settlement_status': 1 });
packageReservationSchema.index({ status: 1 });

// 예약번호 자동 생성 메서드
packageReservationSchema.statics.generateReservationNumber = async function() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    
    const prefix = `PKG-${year}${month}-`;
    
    // 이번 달의 마지막 예약번호 찾기
    const lastReservation = await this.findOne({
        reservation_number: new RegExp(`^${prefix}`)
    }).sort({ reservation_number: -1 });
    
    let nextNumber = 1;
    if (lastReservation) {
        const lastNumber = parseInt(lastReservation.reservation_number.split('-')[2]);
        nextNumber = lastNumber + 1;
    }
    
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
};

// 정산 금액 자동 계산 메서드
packageReservationSchema.methods.calculateSettlement = function() {
    // 총 매입액 계산
    const total_cost_krw = this.cost_components.reduce((sum, component) => {
        return sum + (component.cost_krw || 0);
    }, 0);
    
    // 총 거래액 (원화 환산)
    const total_revenue_krw = this.pricing.currency === 'KRW' 
        ? this.pricing.total_selling_price
        : this.pricing.total_selling_price * this.pricing.exchange_rate;
    
    // 마진 계산
    const total_margin_krw = total_revenue_krw - total_cost_krw;
    const margin_rate = total_revenue_krw > 0 
        ? (total_margin_krw / total_revenue_krw * 100).toFixed(2)
        : 0;
    
    // 부가세 (마진의 10%)
    const vat_amount = Math.round(total_margin_krw * 0.1);
    
    this.settlement = {
        ...this.settlement,
        total_revenue_krw: Math.round(total_revenue_krw),
        total_cost_krw: Math.round(total_cost_krw),
        total_margin_krw: Math.round(total_margin_krw),
        margin_rate: parseFloat(margin_rate),
        vat_amount: vat_amount,
        settlement_status: this.settlement?.settlement_status || 'pending'
    };
};

// 저장 전 자동 계산
packageReservationSchema.pre('save', function() {
    // 박수/일수 자동 계산
    if (this.travel_period.departure_date && this.travel_period.return_date) {
        const departure = new Date(this.travel_period.departure_date);
        const returnDate = new Date(this.travel_period.return_date);
        const diffTime = Math.abs(returnDate - departure);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        this.travel_period.nights = diffDays;
        this.travel_period.days = diffDays + 1;
    }
    
    // 정산 금액 자동 계산
    this.calculateSettlement();
});

module.exports = mongoose.model('PackageReservation', packageReservationSchema);
