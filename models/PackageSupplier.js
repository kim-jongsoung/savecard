const mongoose = require('mongoose');

const packageSupplierSchema = new mongoose.Schema({
    // 공급업체 유형
    supplier_type: {
        type: String,
        required: true,
        enum: ['flight', 'ground', 'hotel', 'tour', 'other']
    },
    
    // 공급업체명
    supplier_name: {
        type: String,
        required: true
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
    
    // 메모
    notes: {
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
packageSupplierSchema.index({ supplier_type: 1 });
packageSupplierSchema.index({ supplier_name: 1 });
packageSupplierSchema.index({ is_active: 1 });

module.exports = mongoose.model('PackageSupplier', packageSupplierSchema);
