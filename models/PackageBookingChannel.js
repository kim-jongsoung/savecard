const mongoose = require('mongoose');

const packageBookingChannelSchema = new mongoose.Schema({
    // 예약채널명
    channel_name: {
        type: String,
        required: true,
        unique: true
    },
    
    // 담당자 정보
    contact_person: {
        type: String,
        default: ''
    },
    contact_email: {
        type: String,
        default: ''
    },
    contact_phone: {
        type: String,
        default: ''
    },
    
    // 활성화 상태
    is_active: {
        type: Boolean,
        default: true
    }
    
}, {
    timestamps: true  // createdAt, updatedAt 자동 생성
});

// 인덱스
packageBookingChannelSchema.index({ channel_name: 1 });
packageBookingChannelSchema.index({ is_active: 1 });

module.exports = mongoose.model('PackageBookingChannel', packageBookingChannelSchema);
